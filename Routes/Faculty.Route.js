import express from 'express';
import jwt from 'jsonwebtoken';

import fs from 'fs';
import multer from 'multer';
import path from 'path';
import facultyDb from '../faculty.db.js';
const router = express.Router();
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const userId = req.user.user_id;
        const uploadPath = path.join('public/uploads', userId);

        // Create the directory if it doesn't exist
        fs.mkdirSync(uploadPath, { recursive: true });

        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const userId = req.user.user_id;
       
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        const filename = `${userId}-${uniqueSuffix}${fileExtension}`;

        // Store the file path in the database without the 'public/' part
        const filePathForDatabase = path.join('uploads', userId, filename);
        req.body.supportive_doc = filePathForDatabase;

        cb(null, filename);
    }
});


const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 50 // 50MB
    }
});

router.use((req, res, next) => {
    if (req.cookies.token) {
        try {
            const user = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
            req.user = user;
            console.log('Decoded JWT:', user); // Log the decoded JWT payload
            console.log('User ID:', user.user_id); // Log the user ID specifically
            res.locals.loggedIn = user.loggedIn; // Set a local variable
        } catch (err) {
            console.error('JWT verification error:', err);
            res.clearCookie('token');
            res.locals.loggedIn = false; // Set a local variable
        }
    } else {
        res.locals.loggedIn = false; // Set a local variable
    }
    next();
});



router.get('/login', (req, res) => {
    res.render("./Faculty/login");
});

router.post('/login', async (req, res) => {
    console.log("admin2");

    const username = req.body.uname;
    const password = req.body.password;

    try {
        const result = await facultyDb.query(
            'SELECT * FROM user_type_master WHERE user_name = ? AND password = ? And user_type_type ="employee"',
            [username, password]
        );
        const user = result[0];

        if (user.length > 0) {
            const user_id = user[0].user_type_id;
            const role = 'faculty'; // Hardcoding role for faculty
            const token = jwt.sign({ user_id, role }, process.env.JWT_SECRET, { expiresIn: '2h' });
            
            res.cookie('token', token, { httpOnly: true });
            res.redirect('/Faculty/home');
            //res.render('./Faculty/dashboard', { data: data });
        } else {
            res.render('./Faculty/login', { error: 'Invalid username or password' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});
router.get("/home", async (req, res) => {
    console.log('Faculty home');
    const userId = req.user.user_id;
  

    try {
        const [userTypeResult] = await facultyDb.query(
            "SELECT user_type_id FROM user_master WHERE user_type_id = ?",
            [userId]
        );
            console.log(userTypeResult)
        const userTypeId = userTypeResult[0]?.user_type_id;

        if (userTypeId) {
            console.log('User type ID found:', userTypeId);
            res.redirect('/dashboard'); // Redirect to dashboard if user_type_id is found
        } else {
            console.log('No user_type_id found for the given user ID');
            res.redirect('/faculty/register'); // Redirect to register if user_type_id is not found
        }
    } catch (error) {
        console.error('Error executing query', error);
        res.status(500).send('Internal Server Error');
    }
});


router.post('/upload', upload.any(), async (req, res) => {
    if (!req.user) return res.status(401).send('Access denied. No token provided.');
    try {
        const userId = req.user.user_id;
        console.log('User ID from JWT:', userId); // Log the user ID from JWT
        const scores = req.body.self_approved_scores;
        const docs = req.files;

        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            const sr_no = parseInt(doc.fieldname.match(/\d+/)[0]); // Extract the sr_no from the fieldname
            const score = scores[sr_no ]; // Adjust this line if the scores are not 0-indexed

            // Replace backslashes with forward slashes in the path and remove '/public'
            let docPath = doc.path.replace(/\\/g, '/').replace(/^public\//, '');

            console.log('Document path:', docPath);

            // First, check if the user_id and sr_no already exist in the teaching_user table
            const [rows] = await facultyDb.query(
                'SELECT * FROM teaching_user WHERE user_id = ? AND sr_no = ?',
                [userId, sr_no]
            );

            // If not, insert them
            if (rows.length === 0) {
                await facultyDb.query(
                    'INSERT INTO teaching_user (user_id, sr_no) VALUES (?, ?)',
                    [userId, sr_no]
                );
            }

            // Then, update the Self_Approved_Scores
            await facultyDb.query(
                'UPDATE teaching_user SET Self_Approved_Scores = ? WHERE user_id = ? AND sr_no = ?',
                [score, userId, sr_no]
            );

            // Finally, insert into the teaching_doc table
            await facultyDb.query(
                'INSERT INTO teaching_doc (user_id, sr_no, supportive_doc) VALUES (?, ?, ?)',
                [userId, sr_no, docPath]
            );
        }

        res.redirect("/faculty/dashboard2");
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});
router.get('/dashboard2', async (req, res) => {
    if (!req.user) return res.status(401).send('Access denied. No token provided.');

    try {
        const userId = req.user.user_id;

        // Fetch the data from the database
        const [rows] = await facultyDb.query(
            `SELECT u.email_id, t.sr_no, t.Parameter, t.Maximum_Scores, tu.Self_Approved_Scores, td.supportive_doc 
            FROM teaching t 
            INNER JOIN teaching_user tu ON t.sr_no = tu.sr_no 
            INNER JOIN user_master u ON tu.user_id = u.user_id 
            LEFT JOIN teaching_doc td ON tu.user_id = td.user_id AND tu.sr_no = td.sr_no 
            WHERE tu.user_id = ?`,
            [userId]
        );

        // Group the supportive_doc by sr_no
        const data = rows.reduce((acc, row) => {
            if (!acc[row.sr_no]) {
                // If this sr_no is not yet in the accumulator, add it
                acc[row.sr_no] = { ...row, supportive_doc: [row.supportive_doc] };
            } else {
                // If this sr_no is already in the accumulator, append the supportive_doc
                acc[row.sr_no].supportive_doc = [...acc[row.sr_no].supportive_doc, row.supportive_doc];
            }
            return acc;
        }, {});

        const totalMaximumScores = rows.reduce((total, row) => total + row.Maximum_Scores, 0);
        const totalSelfApprovedScores = rows.reduce((total, row) => total + row.Self_Approved_Scores, 0);
        
        // Render the EJS template and pass the data
        res.render('./Faculty/dashboard2', { 
            data: Object.values(data), 
            totalMaximumScores, 
            totalSelfApprovedScores 
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

router.get("/criteria", async (req, res) => {
    try {
        const data = await facultyDb.query('SELECT criteria_description FROM criteria_master');
        if (!data) {
            console.log('No data returned from the query');
            res.status(500).send('No data returned from the query');
            return;
        }
        res.render('./Faculty/criteriaSelect', {data: data[0] });
    } catch (error) {
        console.error('Error executing query', error);
        res.status(500).send('Error executing query');
    }
});
router.post("/criteria", async (req, res) => {
    const criteria=req.body.criteria_name;
    const Parameter=req.body.parameter;
    const total = req.body.totalMarks;
    try {
        const data = await facultyDb.query('SELECT criteria_id  FROM criteria_master where criteria_description=?',[criteria]);
        if (!data) {
            console.log('No data returned from the query');
            res.status(500).send('No data returned from the query');
            return;
        }

        console.log(data[0][0].criteria_id);
        const criteria_id=data[0][0].criteria_id;
        const result = await facultyDb.query('INSERT INTO  c_parameter_master (criteria_id,parameter_description , parameter_max_marks ) VALUES (?,?,?)',[criteria_id,Parameter,total]);

        res.redirect("/faculty/criteria");
    } catch (error) {
        console.error('Error executing query', error);
        res.status(500).send('Error executing query');
    }

});

router.get('/register', (req, res) => {
    res.render('./Faculty/registration');
})
router.post('/register', async (req, res) => {
    const {
        firstName,
        middleName = '', 
        lastName,
        email,
        contact,
        dob,
        panCard,
        aadhaar,
        employeeId,
        instituteId, // Expecting the name of the institute from the form
        departmentId // Expecting the name of the department from the form
    } = req.body;
    console.log(firstName + ' ' + middleName + ' ' + email + ' ' + contact + ' ' + dob + ' ' + panCard + ' ' + aadhaar + ' ' + employeeId + ' ' + instituteId + ' ' + departmentId);

    

    try {
        const password= "Misfits"


        
        
        const sql = ` insert into user_type_master (user_name,password,user_type_type) values (?,?,?)`;
        const [result1] = await facultyDb.execute(sql, [email, password, 'employee']);
        console.log('Insert Result:', result1);

      
        const id = `select user_type_id from user_type_master where user_name = ?`;
        const [result2] = await facultyDb.execute(id, [email]);
        console.log('Insert Result:', result2[0]);

        const user_type_id = result2[0].user_type_id; // Get the user_type_id


        const query = `
            INSERT INTO user_master (
                first_name,
                middle_name,
                last_name,
                email_id,
                contact_no,
                pan_card_no,
                addhar_no,
                emp_id,
                institution_id,
                dept_id,
                user_type_id,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive')
        `;

        const [result] = await facultyDb.execute(query, [
            firstName,
            middleName,
            lastName,
            email,
            contact,
            panCard,
            aadhaar,
            employeeId,
            instituteId,
            departmentId,
            user_type_id
        ]);

        console.log('Insert Result:', result);
        res.redirect("/Faculty/wait");
    } catch (error) {
        console.error('Error inserting data:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get("/wait", async(req, res) =>{
        res.render("./Faculty/wait")
})





router.get("/dashboard", async(req, res) =>{

})

export default router;
