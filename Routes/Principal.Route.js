import express from 'express';
import jwt from 'jsonwebtoken';

import facultyDb from '../faculty.db.js';
import { authorizeRole, jwtMiddleware,sendApprovalEmail } from '../service.js';
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



router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/principal/login')});

export default router;