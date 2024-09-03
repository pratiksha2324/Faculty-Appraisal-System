import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import facultyDb from '../faculty.db.js';
import { authorizeRole, jwtMiddleware, sendApprovalEmail, transporter } from '../service.js';
const router = express.Router();

router.use(jwtMiddleware);

router.get('/login', (req, res) => {
    console.log("admin");
    res.render("./Principal/login");
});
// JWT Middleware
router.use(async (req, res, next) => {
    if (req.cookies.token) {
        try {
            const user = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
            req.user = user;
            console.log(user.institution_id)

            if (user.role === 'admin') {
                const [pendingRequests] = await facultyDb.query(
                    'SELECT COUNT(*) AS count FROM user_master WHERE status = "inactive" AND institution_id =  ?',
                    [user.institution_id]
                );
                console.log(pendingRequests)
                res.locals.pendingRequestsCount = pendingRequests[0].count;
                console.log("pending requests count",res.locals.pendingRequestsCount);
            } else {
                res.locals.pendingRequestsCount = 0;
            }

            res.locals.loggedIn = true;
        } catch (err) {
            console.error('JWT verification error:', err);
            res.clearCookie('token');
            res.locals.loggedIn = false;
            res.locals.pendingRequestsCount = 0;
        }
    } else {
        res.locals.loggedIn = false;
        res.locals.pendingRequestsCount = 0;
    }
    next();
});

//2fa verfication 


router.post('/verify', async function (req, res) {
    const username = req.body.username;
    const otp = req.body.otp;
    console.log('Username:', username);
    console.log('OTP:', otp);
    try {
        const q = await facultyDb.query(`SELECT otp, timestamp FROM otp_master WHERE email_id = ?
        AND status = 'active' ORDER BY timestamp DESC LIMIT 1;`, [username]
        )
        console.log(q);
        const otpData = q[0][0n];
        const oldOTP= otpData.otp;
        const timestamp = otpData.timestamp;
    
        console.log(oldOTP, timestamp);
        const currentTime = new Date().getTime();
        if (currentTime - timestamp > 300000) {
            console.log('The OTP has expired. Please request a new OTP.')
            return res.render('./Principal/login', { error: 'The OTP has expired. Please request a new OTP.' });
        }
        if (String(oldOTP) !== String(otp)) {
            console.log('error', 'Invalid OTP.');
            return res.render('./Principal/verify', { error: 'Invalid OTP.', username });
        }
        else {
            console.log('success', 'OTP verified successfully.');
            const [result] = await facultyDb.query(
                'UPDATE otp_master SET status = "inactive" WHERE email_id = ? AND otp = ?',
                [username, otp]
            );
            const userSql = await facultyDb.query(
                'SELECT * FROM user_type_master WHERE user_name = ? AND user_type_type= "admin"', [username]);
            const user =userSql [0];
            const sql = "SELECT institution_id FROM user_master WHERE user_type_id = ?";
            const [results] = await facultyDb.query(sql, [user[0].user_type_id]);
            console.log(results);
            const user_id = user[0].user_type_id;
            const role = user[0].user_type_type; // Assuming `user_type_type` indicates role
            const institution_id = results[0].institution_id; // Assuming the query returns at least one result
        
            console.log('User ID from DB:', user_id);
            console.log('Role from DB:', role);
            console.log('Institution ID from DB:', institution_id);
        
            const token = jwt.sign({ user_id, role, institution_id }, process.env.JWT_SECRET, { expiresIn: '2h' });
            console.log('Generated JWT:', token);
            
            res.cookie('token', token, { httpOnly: true });
            res.redirect('/principal/dashboard');
        }
    } catch (error) {
        console.error(error);
    }
})
router.post('/login', async (req, res) => {
    
    const username = req.body.uname;
    const password = req.body.password;
    console.log("admin2", username, password);

    try {
        const result = await facultyDb.query(
            'SELECT * FROM user_type_master WHERE user_name = ? AND password = ? AND user_type_type= "admin"',
            [username, password]
        );
        const user = result[0]; // Access the actual user data
        console.log('User from DB:',user);
        if (user.length > 0) {
             // Generate a 6-digit OTP
             const otp = crypto.randomInt(100000, 999999).toString();

             // Store OTP in OTP_MASTER table
             await facultyDb.query(
                 'INSERT INTO OTP_MASTER (OTP_ID, EMAIL_ID, OTP, STATUS) VALUES (?, ?, ?, "active")',
                 [crypto.randomBytes(16).toString('hex'), username, otp]
             );
 
             // Send OTP to user's email
             let mailOptions = {
                 from: process.env.EMAIL_USERNAME,
                 to: username, // assuming username is the user's email
                 subject: 'Your OTP',
                 text: `Your OTP is ${otp}`
             };
 
             transporter.sendMail(mailOptions, function(error, info){
                 if (error) {
                     console.log(error);
                 } else {
                     console.log('Email sent: ' + info.response);
                 }
             });
 





          
            res.render("./principal/verify",{username:username})
        } else {
            res.render("./Principal/login", { error: "Invalid username or password." });
        }
    } catch (error) {
        console.error(error);
        res.render("./Principal/login", { error: "An error occurred. Please try again." });
    }
});

router.use(authorizeRole('admin'));



    
    // Protect all routes after this line with the 'admin' role
    router.use(authorizeRole(['admin']));

router.get('/dashboard', (req, res) => {
    res.render('./Principal/emptable');
});

router.get('/approvals', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send('Access denied.');

    console.log(req.user.institution_id);
    try {
        const [pendingRequests] = await facultyDb.query(
            `SELECT user_id, first_name, middle_name, last_name, email_id, contact_no, emp_id
            FROM user_master
            WHERE status = "inactive" AND institution_id = ?`,
            [req.user.institution_id]
        );

        res.render('./Principal/approvals', { pendingRequests });
    } catch (error) {
        console.error('Error fetching pending requests:', error);
        res.status(500).send('Internal Server Error');
    }
});
router.post('/approve', async (req, res) => {
    // Check if the user has admin privileges
    if (req.user.role !== 'admin') return res.status(403).send('Access denied.');

    const { user_id } = req.body;

    try {
        // Fetch user details using user_id
        const [user] = await facultyDb.query(
            'SELECT user_id, first_name, last_name, email_id FROM user_master WHERE user_id = ?',
            [user_id]
        );

        if (user.length === 0) return res.status(404).send('User not found.');

        const email = user[0].email_id; // Extract the email from the fetched user details

        // Update the user's status to "active" in the user_type_master table using email
        const [result1] = await facultyDb.query(
            'UPDATE user_type_master SET status = "active" WHERE user_name = ?',
            [email]
        );

        // Update the user's status to "active" in the user_master table using user_id
        const [result] = await facultyDb.query(
            'UPDATE user_master SET status = "active" WHERE user_id = ?',
            [user_id]
        );

        if (result.affectedRows > 0 && result1.affectedRows > 0) {
            // Send email notification to the user about approval
            await sendApprovalEmail(user[0]);

            // Redirect with a success message to the principal's approvals page
            res.redirect('/principal/approvals');
        } else {
            res.status(404).send('User not found or update failed.');
        }
    } catch (error) {
        console.error('Error approving request:', error);
        res.status(500).send('Internal Server Error');
    }
});



router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/principal/login')});

export default router;