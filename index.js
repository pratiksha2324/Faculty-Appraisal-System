import bodyParser from 'body-parser';
import flash from "connect-flash"; // For displaying flash messages
import cookieParser from "cookie-parser";
import cors from "cors";
import { config } from 'dotenv'; //environment variable
import express from 'express'; // Web framework
import session from "express-session";

import bcrypt from 'bcryptjs';
import CommitteeRoute from "./Routes/Committee.Route.js";
import FacultyRoutes from "./Routes/Faculty.Route.js";
import PrincipalRoute from "./Routes/Principal.Route.js";
import SuperAdminRoute from "./Routes/SuperAdmin.Route.js";
import facultyDb from './faculty.db.js';
config();
const app = express();
app.use(cors());
app.use(cookieParser())
// Define the port number
const PORT = 8800

app.use(express.static('public'));
app.use(express.static('uploads'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Set the view engine to use EJS
app.set('view engine', 'ejs');
app.set('views', './views');
// Set up session middleware
app.use(session({
  secret: 'PixelPioneers',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week in milliseconds
}));
app.use(flash());



app.use("/principal",PrincipalRoute);
app.use("/faculty",FacultyRoutes);
app.use("/committee",CommitteeRoute);
app.use("/superAdmin",SuperAdminRoute);

app.get("/", async function (req, res) {
  try {
    const password="superAdmin"
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const sql = `INSERT INTO user_type_master (user_name, password, user_type_type) VALUES (?, ?, ?)`;
    const [result1] = await facultyDb.execute(sql, ["superAdmin" ,hashedPassword, 'superAdmin']);
  } catch (error) {
    console.log(error);
  }


  res.render("index");
});
app.get('/api/departments', async (req, res) => {
  const { institution_id } = req.query;
  try {
      const [departments] = await facultyDb.query(
          'SELECT dept_id, department_name FROM department_master WHERE institution_id = ? AND status = "active"',
          [institution_id]
      );
      res.json(departments);
  } catch (error) {
      console.error('Error fetching departments:', error);
      res.status(500).send('Internal Server Error');
  }
});
app.get('/api/institutes', async (req, res) => {
  try {
      const [institutes] = await facultyDb.query('SELECT institution_id, institution_name FROM institution_master WHERE status = "active"');
      res.json(institutes);
  } catch (error) {
      console.error('Error fetching institutes:', error);
      res.status(500).send('Internal Server Error');
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
