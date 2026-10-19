import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import ejs from "ejs"; // import explicite : Vercel doit voir ce module pour l'inclure
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

// --- Base de données ---------------------------------------------------------
// En production (Vercel) : variable d'environnement DATABASE_URL.
// En local : on retombe sur ta base PostgreSQL locale.
const databaseUrl = process.env.DATABASE_URL;

const db = databaseUrl
  ? new pg.Pool({
      // On retire sslmode de l'URL : on gère le SSL explicitement ci-dessous
      connectionString: databaseUrl.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""),
      ssl: { rejectUnauthorized: false },
      max: 3, // peu de connexions : on est en mode serverless
    })
  : new pg.Pool({
      user: "postgres",
      host: "localhost",
      database: "world",
      password: "123456789",
      port: 5432,
    });

// --- Configuration Express ---------------------------------------------------
app.engine("ejs", ejs.__express);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // en local ; sur Vercel, public/ est servi automatiquement

let currentUserId = 1;
let users = [];

async function checkVisisted() {
  const result = await db.query(
    "SELECT country_code FROM visited_countries WHERE user_id = $1",
    [currentUserId]
  );
  return result.rows.map((row) => row.country_code);
}

async function getCurrentUser() {
  const result = await db.query("SELECT * FROM users ORDER BY id");
  users = result.rows;
  // Si l'utilisateur courant n'existe plus, on prend le premier
  return users.find((u) => u.id == currentUserId) || users[0];
}

async function renderHome(res, error) {
  const currentUser = await getCurrentUser();
  currentUserId = currentUser.id;
  const countries = await checkVisisted();
  res.render("index.ejs", {
    countries,
    total: countries.length,
    users,
    color: currentUser.color,
    error,
  });
}

// --- Routes ------------------------------------------------------------------
app.get("/", async (req, res) => {
  try {
    await renderHome(res);
  } catch (err) {
    console.log(err);
    res.status(500).send("Erreur de base de données : " + err.message);
  }
});

app.post("/add", async (req, res) => {
  const input = (req.body["country"] || "").trim().toLowerCase();
  try {
    const result = await db.query(
      "SELECT country_code FROM countries WHERE LOWER(country_name) LIKE '%' || $1 || '%'",
      [input]
    );
    if (!input || result.rows.length === 0) {
      return await renderHome(res, "Country name does not exist, try again.");
    }
    const countryCode = result.rows[0].country_code;
    try {
      await db.query(
        "INSERT INTO visited_countries (country_code, user_id) VALUES ($1, $2)",
        [countryCode, currentUserId]
      );
      res.redirect("/");
    } catch (err) {
      console.log(err);
      await renderHome(res, "Country has already been added, try again.");
    }
  } catch (err) {
    console.log(err);
    res.status(500).send("Erreur : " + err.message);
  }
});

app.post("/user", async (req, res) => {
  if (req.body.add === "new") {
    res.render("new.ejs");
  } else {
    currentUserId = req.body.user;
    res.redirect("/");
  }
});

app.post("/new", async (req, res) => {
  try {
    const result = await db.query(
      "INSERT INTO users (name, color) VALUES($1, $2) RETURNING *",
      [req.body.name, req.body.color]
    );
    currentUserId = result.rows[0].id;
    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.status(500).send("Erreur : " + err.message);
  }
});

// En local uniquement : sur Vercel, l'app est exportée ci-dessous
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

export default app;
