import bcrypt from 'bcryptjs';
import express from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
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
    const message = req.query.message || '';
    const error = req.query.error || '';
    const username = req.query.username || '';
    res.render('./Faculty/login', { message, error, username });
});




router.post('/login', async (req, res) => {
    console.log("admin2");

    const username = req.body.username;
    const email=username;
    const password = req.body.password;

    try {
        const result = await facultyDb.query(
            'SELECT * FROM user_type_master WHERE user_name = ? AND user_type_type = "employee"',
            [username]
        );
        const user = result[0];

        if (user.length > 0) {
            const user_id = user[0].user_type_id;
            const role = 'faculty'; // Hardcoding role for faculty
            const status = user[0].status; // Assuming `status` is a field in `user_type_master`
            const hashedPassword = user[0].password; // Assuming `password` is a field in `user_type_master`

            const passwordMatch = await bcrypt.compare(password, hashedPassword);
            const isDefaultPassword = await bcrypt.compare('Misfits', hashedPassword);

            // Check if the user status is inactive
            if (status === 'inactive') {
                res.redirect(`/faculty/wait?email=${encodeURIComponent(email)}`);
            } else if (!passwordMatch) {
                res.render('./Faculty/login', { error: 'Invalid username or password', message: '', username: email});
            } else {
                // Check if the password is the default password
                if (isDefaultPassword) {
                    res.redirect(`/faculty/reset-password?user_id=${user_id}`);
                } else {
                    const token = jwt.sign({ user_id, role }, process.env.JWT_SECRET, { expiresIn: '2h' });
                    res.cookie('token', token, { httpOnly: true });
                    res.redirect('/Faculty/home');
                    //res.render('./Faculty/dashboard', { data: data });
                }
            }
        } else {
            res.render('./Faculty/login', { error: 'Invalid username or password', message: '', username: '' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});
router.get('/logout', (req, res) => {
    // Clear the JWT token cookie
    res.clearCookie('token');
    
    // Redirect the user to the login page or home page after logout
    res.redirect('/faculty/login'); // Adjust the path as needed
});



router.get("/home", async (req, res) => {
    console.log('Faculty home');
    const userId = req.user.user_id;
  res.render('./Faculty/home');


});



router.get('/register', (req, res) => {

    res.render('./Faculty/registration',{successMsg:"",errorMsg:""});
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
        instituteId, 
        departmentId 
    } = req.body;
    
    try {
        const password = "Misfits";
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        // Insert into user_type_master table
        const sql = `INSERT INTO user_type_master (user_name, password, user_type_type, status) VALUES (?, ?, ?, ?)`;
        try {
            const [result1] = await facultyDb.execute(sql, [email, hashedPassword, 'employee', 'inactive']);
            console.log('Insert Result (user_type_master):', result1);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.render('./Faculty/registration', { successMsg: "", errorMsg: "User already exists with the given email." });
            } else {
                console.error('Error inserting into user_type_master:', error);
                return res.render('./Faculty/registration', { successMsg: "", errorMsg: "An error occurred while registering the user." });
            }
        }

        // Retrieve the user_type_id
        const idQuery = `SELECT user_type_id FROM user_type_master WHERE user_name = ?`;
        let user_type_id;
        try {
            const [result2] = await facultyDb.execute(idQuery, [email]);
            console.log('Select Result (user_type_id):', result2[0]);
            user_type_id = result2[0].user_type_id; // Get the user_type_id
        } catch (error) {
            console.error('Error retrieving user_type_id:', error);
            return res.render('./Faculty/registration', { successMsg: "", errorMsg: "An error occurred while retrieving user data." });
        }

        // Insert into user_master table
        const userInsertQuery = `
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

        try {
            const [result] = await facultyDb.execute(userInsertQuery, [
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
            console.log('Insert Result (user_master):', result);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.render('./Faculty/registration', { successMsg: "", errorMsg: "Duplicate entry detected. Please ensure unique values for email, PAN, and Aadhaar." });
            } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
                return res.render('./Faculty/registration', { successMsg: "", errorMsg: "Invalid institution or department ID." });
            } else {
                console.error('Error inserting into user_master:', error);
                return res.render('./Faculty/registration', { successMsg: "", errorMsg: "An error occurred while saving user details." });
            }
        }

        res.redirect(`/faculty/wait?email=${encodeURIComponent(email)}`);

    } catch (error) {
        console.error('Unexpected Error:', error);
        res.status(500).render('./Faculty/registration', { successMsg: "", errorMsg: "Internal Server Error." });
    }
});

// Endpoint for rendering the wait.ejs page
router.get("/wait", (req, res) => {
    const email = req.query.email; // Get the email from query parameters

    if (!email) {
        return res.status(400).send('Email is required to check the approval status.');
    }

    // Render the wait page
    return res.render('./Faculty/wait', { email });
});

// Endpoint for checking the user status
router.get("/check-status", async (req, res) => {
    const email = req.query.email; // Get the email from query parameters
    console.log("test")
    if (!email) {
        return res.status(400).send('Email is required to check the approval status.');
    }

    try {
        // Fetch the user's status from the database using email
        const [result] = await facultyDb.query(
            'SELECT status FROM user_type_master WHERE user_name = ?',
            [email]
        );

        if (result.length > 0) {
            const status = result[0].status;

            // Check if the status is now active
            if (status === 'active') {
                // Send a success response with the approval message
                console.log("pass")
                return res.json({message:'Your request has been approved. Please log in.',username : email});
            } else {
                // If still inactive, send a response with the status
                return res.json({message: 'Your request is still pending.', status: 'inactive'});
            }
        } else {
            return res.status(404).send('User not found.');
        }
    } catch (error) {
        console.error('Error checking user status:', error);
        return res.status(500).send('Internal Server Error');
    }
});


// Fetch parameters based on criteria
router.get('/get-parameters/:criteriaId', async (req, res) => {
    const criteriaId = req.params.criteriaId;
    try {
        const [rows] = await facultyDb.execute('SELECT c_parameter_id, parameter_description FROM c_parameter_master WHERE criteria_id = ? AND status = "active"', [criteriaId]);
        res.json({ parameters: rows });
    } catch (error) {
        console.error('Error fetching parameters:', error);
        res.status(500).send('Internal Server Error');
    }
});


router.get("/dashboard", async(req, res) =>{
    res.render("./Faculty/appraisal")
})
router.get('/reset-password', (req, res) => {
    const user_id = req.query.user_id;
    res.render('./Faculty/reset-password', { user_id });
});

router.post('/reset-password', async (req, res) => {
    const user_id = req.body.user_id;
    const newPassword = req.body.newPassword;
    const confirmPassword = req.body.confirmPassword;
    console.log(confirmPassword, newPassword, user_id);

    if (newPassword === confirmPassword) {
        try {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(newPassword, salt);

            const result = await facultyDb.query(
                'UPDATE user_type_master SET password = ? WHERE user_type_id = ?',
                [hashedPassword, user_id]);
            
            // Get the username from the database using the user_id
            const userResult = await facultyDb.query(
                'SELECT user_name FROM user_type_master WHERE user_type_id = ?',
                [user_id]
            );
            const username = userResult[0][0].user_name;

            res.redirect(`/Faculty/login?message=Password changed successfully!&username=${encodeURIComponent(username)}`);
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    } else {
        res.render('reset-password', { user_id, error: 'Passwords do not match. Please try again.' });
    }
});


router.get('/criteria-status', async (req, res) => {
    console.log("criteria-status");
    const successMsg = req.query.successMsg || "";
    try {
        // Get user type ID from the request
        const userTypeId = req.user.user_id;
        if (!userTypeId) {
            return res.status(400).send('User type ID is required');
        }

        // Query to get the user ID based on the user type ID
        const sql = `SELECT user_id FROM user_master WHERE user_type_id = ?`;
        const result = await facultyDb.query(sql, [userTypeId]);
        console.log('User Query Result:', result);

        if (result.length === 0) {
            return res.status(404).send('User not found');
        }

        const userId = result[0][0].user_id;
        console.log('User IDaa:', userId);

        // SQL query to get criteria status and actions
        const query2 = `
            SELECT
                c.criteria_id AS 'Criteria Number',
                c.criteria_description AS 'Criteria Name',
                CASE
                    WHEN MAX(sas.record_id) IS NOT NULL THEN 'Applied'
                    ELSE 'Not Applied'
                END AS 'Self-Appraisal Status',
                CASE
                    WHEN MAX(cm.record_id) IS NOT NULL THEN 'Reviewed'
                    ELSE 'Not Reviewed'
                END AS 'Committee Status'
            FROM criteria_master c
            LEFT JOIN c_parameter_master p
                ON c.criteria_id = p.criteria_id
            LEFT JOIN self_appraisal_score_master sas
                ON p.c_parameter_id = sas.c_parameter_id AND sas.user_id = ? AND sas.status = 'active'
            LEFT JOIN committee_master cm
                ON p.c_parameter_id = cm.c_parameter_id AND cm.user_id_employee = ? AND cm.status = 'active'
            WHERE c.status = 'active'
            GROUP BY c.criteria_id, c.criteria_description;
        `;

        // Execute the query with the user ID
        const results2 = await facultyDb.query(query2, [userId, userId]);
        console.log('Criteria Results21:', results2[0]);

        if (results2.length === 0) {
            console.log('No criteria data found');
        }

        // Render the results in the view
        res.render('./Faculty/criteria-status', { userId, data: results2[0] ,successMsg});

    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});


router.post("/apply", upload.any(), async (req, res) => {
    if (!req.user) {
        return res.status(401).send('Access denied. No token provided.');
    }

    const userTypeId = req.user.user_id;
    const criteriaId = req.body.criteriaId;

    try {
        // Fetch user ID based on userTypeId
        const [userResults] = await facultyDb.query('SELECT user_id FROM user_master WHERE user_type_id = ?', [userTypeId]);
        
        if (userResults.length === 0) {
            return res.status(404).send('User not found');
        }

        const userId = userResults[0].user_id;
        const marksData = [];
        const documentData = {};

        // Prepare data for self_appraisal_score_master
        for (const param in req.body) {
            if (param.startsWith('self_approved_')) {
                const paramId = param.replace('self_approved_', '');
                const marks = parseInt(req.body[param], 10);
                if (!isNaN(marks)) {
                    marksData.push([userId, marks, paramId, 'active']);
                }
            }
        }

        // Insert self-approved marks one by one
        for (const mark of marksData) {
            await facultyDb.query('INSERT INTO self_appraisal_score_master (user_id, marks_by_emp, c_parameter_id, status) VALUES (?, ?, ?, ?)', mark);
        }

        // Prepare data for document_master
        req.files.forEach(file => {
            const paramIdMatch = file.fieldname.replace(/^public\//, '').match(/^documents_(C_PARA\d+)\[\]$/);
            const paramId = paramIdMatch ? paramIdMatch[1] : null;
            if (paramId) {
                const docPath = file.path.replace(/\\/g, '/').replace(/^public\//, '');
                if (!documentData[paramId]) {
                    documentData[paramId] = [];
                }
                documentData[paramId].push(docPath);
            } else {
                console.error('Invalid parameter ID in field name:', file.fieldname);
            }
        });

        // Insert documents one by one with sequential document count
        for (const paramId in documentData) {
            const docArray = documentData[paramId];
            let docCount = 1; // Start doc count from 1 for each parameter
            for (const docPath of docArray) {
                await facultyDb.query('INSERT INTO document_master (user_id, c_parameter_id, doc_count, doc_link, location, status) VALUES (?, ?, ?, ?, ?, ?)', [userId, paramId, docCount, docPath, 'uploads/', 'active']);
                docCount++; // Increment doc count for each document
            }
        }

        const successMsg = 'Documents and marks uploaded successfully';
        res.redirect(`/faculty/criteria-status?successMsg=${successMsg}`);
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).send('Internal Server Error');
    }
});


router.get('/apply', async (req, res) => {
    const { criteriaId } = req.query;

    try {
        // Fetch criteria details
        const criteriaQuery = `
            SELECT c.criteria_description AS 'Criteria Name', cp.*
            FROM criteria_master c
            JOIN c_parameter_master cp ON c.criteria_id = cp.criteria_id
            WHERE c.criteria_id = ?
        `;
        const parameters = await facultyDb.query(criteriaQuery, [criteriaId]);
        const CriteriaName = parameters[0][0]['Criteria Name'];        console.log(CriteriaName);
        // Render EJS template
        res.render('faculty/apply', { parameters: parameters[0], criteriaId,CriteriaName });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});



router.get('/view', async (req, res) => {
    const userTypeId = req.user.user_id;
    const { criteriaId } = req.query;
   
    try {
        const [userResults] = await facultyDb.query('SELECT user_id FROM user_master WHERE user_type_id = ?', [userTypeId]);
        
        if (userResults.length === 0) {
            return res.status(404).send('User not found');
        }

        const userId = userResults[0].user_id;
        const criteriaQuery = `
        SELECT c.criteria_description AS 'criteriaName', cp.*, sas.marks_by_emp, COALESCE(cm.comm_score, 'Pending') AS committeeScore
        FROM criteria_master c
        JOIN c_parameter_master cp ON c.criteria_id = cp.criteria_id
        LEFT JOIN self_appraisal_score_master sas ON cp.c_parameter_id = sas.c_parameter_id AND sas.user_id = ?
        LEFT JOIN committee_master cm ON sas.record_id = cm.record_id
        WHERE c.criteria_id = ?
    `;
        const parameters = await facultyDb.query(criteriaQuery, [userId, criteriaId]);

        // Fetch documents uploaded by the logged-in faculty
        const documentQuery = `
            SELECT d.document_id, d.doc_link AS document_path, d.c_parameter_id
            FROM document_master d
            JOIN c_parameter_master cp ON d.c_parameter_id = cp.c_parameter_id
            WHERE cp.criteria_id = ? AND d.user_id = ?
        `;
        const documents = await facultyDb.query(documentQuery, [criteriaId, userId]);

        const criteriaName = parameters[0][0].criteriaName;

        // Render EJS template
        res.render('faculty/edit', { parameters: parameters[0], documents: documents[0], criteriaId, criteriaName });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});











export default router;
