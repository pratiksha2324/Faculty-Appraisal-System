import express from 'express';
import jwt from 'jsonwebtoken';

import facultyDb from '../faculty.db.js';
import { authorizeRole, jwtMiddleware } from '../service.js';
const router = express.Router();

router.use(jwtMiddleware);
router.get('/login', (req, res) => {
    console.log("Committee");
    res.render("./Committee/login");
});
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
    console.log("Committee", username, password);

    try {
        const result = await facultyDb.query(
            'SELECT * FROM user_type_master WHERE user_name = ? AND password = ? AND user_type_type= "committee"',
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
            res.redirect('/Committee/home');
        } else {
            res.render("./Committee/login", { error: "Invalid username or password." });
        }
    } catch (error) {
        console.error(error);
        res.render("./committee/login", { error: "An error occurred. Please try again." });
    }
});




router.get("/home", async (req, res) => {

    res.render("./Committee/home");
})





router.use(authorizeRole('committee'));

router.get("/reports", async (req, res) => {
    const institution_id = req.user.institution_id;
    console.log("institution_id", institution_id);

    try {
        const query = `
            SELECT
                u.user_id,
                u.email_id,
                u.emp_id,
                CONCAT(u.first_name, ' ', u.last_name) AS name,
                d.department_name,
                COUNT(DISTINCT cp.criteria_id) AS criteria_applied,
                total_criteria.total AS total_criteria,
                CASE
                    WHEN COUNT(DISTINCT cp.criteria_id) = total_criteria.total THEN 'Fully filled'
                    WHEN COUNT(DISTINCT cp.criteria_id) > 0 THEN 'Partially filled'
                    ELSE 'Not filled'
                END AS appraisal_status,
                CASE
                    WHEN COUNT(DISTINCT cm.criteria_id) = total_criteria.total THEN 'Fully Reviewed'
                    WHEN COUNT(DISTINCT cm.criteria_id) > 0 THEN 'Partially Reviewed'
                    ELSE 'Not Reviewed'
                END AS committee_status
            FROM
                user_master u
                JOIN department_master d ON u.dept_id = d.dept_id
                LEFT JOIN self_appraisal_score_master sasm ON u.user_id = sasm.user_id AND sasm.status = 'active'
                LEFT JOIN c_parameter_master cp ON sasm.c_parameter_id = cp.c_parameter_id
                LEFT JOIN criteria_master c ON cp.criteria_id = c.criteria_id
                LEFT JOIN (
                    SELECT
                        cm.user_id_employee,
                        cp.criteria_id
                    FROM committee_master cm
                    JOIN c_parameter_master cp ON cm.c_parameter_id = cp.c_parameter_id
                    WHERE cm.status = 'active'
                    GROUP BY cm.user_id_employee, cp.criteria_id
                ) cm ON cm.criteria_id = cp.criteria_id AND cm.user_id_employee = u.user_id
                JOIN user_type_master utm ON u.user_type_id = utm.user_type_id AND utm.user_type_type = 'employee'
                CROSS JOIN (
                    SELECT COUNT(DISTINCT c.criteria_id) AS total
                    FROM criteria_master c
                    WHERE c.status = 'active'
                ) total_criteria
            WHERE
                u.institution_id = ?
                AND EXISTS (
                    SELECT 1 FROM self_appraisal_score_master sa 
                    WHERE sa.user_id = u.user_id AND sa.status = 'active'
                )
            GROUP BY
                u.user_id, u.emp_id, u.first_name, u.last_name, d.department_name, total_criteria.total, u.email_id
        `;
        
        const [rows] = await facultyDb.query(query, [institution_id]);
        if (rows.length === 0) {
            res.render("./Committee/report", { employees: [], error: "No data found." });
            return;
        }
        console.log(rows);

        res.render("./Committee/report", { employees: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

    
router.get('/criteria-Status', async (req, res) => {
        console.log("criteria-status");
        const successMsg = req.query.message || "";
        const userId = req.query.user_id;  // Get user ID from query parameters
    
        if (!userId) {
            console.error('User ID is missing in the request.');
            return res.status(400).send('User ID is required.');
        }
    
        try {
            // SQL query to get criteria status and actions including review status
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
            console.log('Criteria Results:', results2[0]);
    
            if (results2.length === 0) {
                console.log('No criteria data found');
            }
    
            // Render the results in the view
            res.render('./Committee/criteria-status', { userId, data: results2[0], successMsg });
    
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    });
    
    

router.post("/criteria-Status/review", async (req, res) => {
        const userId = req.body.user_id;
        const criteriaId = req.body.criteria_id;
        console.log("criteriaId", criteriaId);
        console.log("userId", userId);
    
        try {
            // Fetch criteria and parameters
            const criteriaQuery = `
                SELECT c.criteria_description AS 'criteriaName', cp.*, 
                       sas.marks_by_emp, COALESCE(cm.comm_score, 'Pending') AS committeeScore
                FROM criteria_master c
                JOIN c_parameter_master cp ON c.criteria_id = cp.criteria_id
                LEFT JOIN self_appraisal_score_master sas ON cp.c_parameter_id = sas.c_parameter_id AND sas.user_id = ?
                LEFT JOIN committee_master cm ON sas.record_id = cm.record_id
                WHERE c.criteria_id = ?
            `;
            const [parameters] = await facultyDb.query(criteriaQuery, [userId, criteriaId]);
    
            // Fetch documents
            const documentQuery = `
                SELECT d.document_id, d.doc_link AS document_path, d.c_parameter_id
                FROM document_master d
                JOIN c_parameter_master cp ON d.c_parameter_id = cp.c_parameter_id
                WHERE cp.criteria_id = ? AND d.user_id = ?
            `;
            const [documents] = await facultyDb.query(documentQuery, [criteriaId, userId]);
    
            // Render EJS template
            res.render('Committee/review', { parameters, documents, criteriaId, criteriaName: parameters[0]?.criteriaName || 'No Criteria', userId });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    });
    
router.post("/save-committee-scores", async (req, res) => {
        const { criteria_id, user_id, ...committeeScores } = req.body;
        console.log(req.user.user_id);
        let commid;  // Define commid here
    
        try {
            const committeeQuery = 
              `  SELECT user_id
                FROM user_master
                WHERE user_type_id = ?`
            ;
            const committeeResult = await facultyDb.query(committeeQuery, [req.user.user_id]);
            console.log("committeeResult", committeeResult);  // Add this line
        
            if (committeeResult.length > 0) {  // Add this check
                commid = committeeResult[0][0].user_id;
                console.log("committee",commid);
            } else {
                console.log("No results from committee query");
            }
        } catch (err) {
            console.error('Error fetching committee members:', err);
            return res.status(500).send('Error retrieving committee members.');
        }    
    
        // Input validation
        if (!criteria_id || !user_id) {
            console.error('Invalid input: criteria_id or user_id is missing');
            return res.status(400).send('Invalid input: criteria_id and user_id are required.');
        }
    
        const scores = [];
    
        console.log('Received committee scores:', committeeScores);
    
        // Extract all committee scores from the request body
        for (const [key, value] of Object.entries(committeeScores)) {
            if (key.startsWith('committee_score_')) {
                const c_parameter_id = key.replace('committee_score_', '');
                const score = parseInt(value, 10);
    
                if (isNaN(score) || score < 0) {
                    console.error(`Invalid score value for parameter ${c_parameter_id}: ${value}`);
                    return res.status(400).send(`Invalid score value for parameter ${c_parameter_id}.`);
                }
    
                // Retrieve the record_id for the given user_id, c_parameter_id, and criteria_id
                let record_id;
                try {
                    const recordQuery = `
                        SELECT record_id
                        FROM self_appraisal_score_master
                        WHERE user_id = ? AND c_parameter_id = ? AND status = 'active'
                    `;
                    const [recordResult] = await facultyDb.query(recordQuery, [user_id, c_parameter_id, criteria_id]);
    
                    console.log(`Record query result for user_id: ${user_id}, c_parameter_id: ${c_parameter_id}, criteria_id: ${criteria_id}:`, recordResult);
    
                    if (recordResult.length === 0) {
                        console.error(`Record ID not found for user_id: ${user_id}, c_parameter_id: ${c_parameter_id}, criteria_id: ${criteria_id}`);
                        continue;  // Skip this parameter
                    }
                    record_id = recordResult[0].record_id;
                    console.log(`Retrieved record_id for parameter ${c_parameter_id}: ${record_id}`);
                } catch (err) {
                    console.error('Error fetching record ID:', err);
                    return res.status(500).send('Error retrieving record ID.');
                }
    
                // Print parameter_id and committee_score
                console.log(`parameter_id: ${c_parameter_id}, committee_score: ${score}`);
    
                // Check if the record already exists
                try {
                    const checkQuery = `
                        SELECT COUNT(*) AS count
                        FROM committee_master
                        WHERE record_id = ? AND user_id_committee = ?
                    `;
                    const [checkResult] = await facultyDb.query(checkQuery, [record_id, user_id]);
    
                    if (checkResult[0].count === 0) {
                        // Prepare values for insertion if record does not exist
                        scores.push([
                           commid ,        // user_id_committee
                            user_id,        // user_id_employee
                            record_id,      // record_id
                            c_parameter_id, // c_parameter_id
                            score           // comm_score
                        ]);
                    } else {
                        console.log(`Record already exists for record_id: ${record_id}`);
                    }
                } catch (err) {
                    console.error('Error checking for existing record:', err);
                    return res.status(500).send('Error checking for existing records.');
                }
            }
        }
    
        console.log('Prepared scores for insertion:', scores);
    
        if (scores.length === 0) {
            console.error('No valid committee scores provided.');
            return res.status(400).send('No valid committee scores provided.');
        }
    
        // Insert scores
        try {
            const insertQuery = `
                INSERT INTO committee_master (user_id_committee, user_id_employee, record_id, c_parameter_id, comm_score)
                VALUES (?)
            `;
          
            for (const score of scores) {
                try {
                    const [insertResult] = await facultyDb.query(insertQuery, [score]);
                    console.log('Insert result:', insertResult);
                } catch (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        console.log('Duplicate entry, skipping:', score);
                    } else {
                        throw err;  // Rethrow the error if it's not a duplicate entry error
                    }
                }
            }
    
            // Redirect to criteria status with userId and success message
            res.redirect(`/committee/criteria-Status?user_id=${user_id}&message=Successfully%20added%20review`);
        } catch (err) {
            console.error('Error inserting committee scores:', err);
            res.status(500).send('Error saving committee scores.');
        }
    });
    

router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/committee/login')});




router.get('/addCriteria', (req, res) => {

    
    res.render('./committee/addCriteria',{success :"",errors:""});


})
router.post('/addCriteria', async(req, res) => {
    const {  criteria_description, max_marks,  } = req.body;
   
    try {
        // Insert data into the database
        await facultyDb.query('INSERT INTO criteria_master ( criteria_description, max_marks) VALUES (?, ?)', [ criteria_description, max_marks]);

        // Send success message and redirect
        res.render('./committee/addCriteria', { success : 'Criteria added successfully!',errors:"" });
    } catch (error) {
        // Handle database errors
        console.error('Database error:', error);
        res.render('./committee/addCriteria', { errors: ['An error occurred while adding the criteria. Please try again.'], success: "" });
    }

})








router.get("/addParams", async (req, res) => {
        try {
            const data = await facultyDb.query('SELECT criteria_description FROM criteria_master');
            if (!data) {
                console.log('No data returned from the query');
                res.status(500).send('No data returned from the query');
                return;
            }
            res.render('./committee/criteriaSelect', { data: data[0], successMessage:"", errorMessage:"" });
        } catch (error) {
            console.error('Error executing query', error);
            res.status(500).send('Error executing query');
        }
    });
    
router.post("/addParams", async (req, res) => {
    const criteria = req.body.criteria_name;
    const parameter = req.body.parameter;
    const totalMarks = req.body.totalMarks;
    const paramType = req.body.param_type; // 'required' or 'optional'
    
    const data1 = await facultyDb.query('SELECT criteria_description FROM criteria_master');
     // Validate inputs
     if (!criteria || !parameter || (paramType === 'required' && (!totalMarks || isNaN(totalMarks) || totalMarks <= 0))) {
        return res.render('./committee/criteriaSelect', { 
            errorMessage: 'All fields are required and Total Marks must be a positive number if the parameter is required!', 
            successMessage: "", 
            data: data1[0]
        });
    }
    
      
    
        try {

            const data = await facultyDb.query('SELECT criteria_id FROM criteria_master WHERE criteria_description = ?', [criteria]);
            if (!data) {
                console.log('No data returned from the query');
                return res.render('./committee/criteriaSelect', { errorMessage: 'No data returned from the query', data: data1[0],successMessage:"" });
            }
    
            const criteria_id = data[0][0].criteria_id;
            await facultyDb.query(
                'INSERT INTO c_parameter_master (criteria_id, parameter_description, parameter_max_marks, parameter_description_type) VALUES (?, ?, ?, ?)',
                [criteria_id, parameter, totalMarks || null, paramType]
            );    
    
            res.render('./committee/criteriaSelect',{successMessage:'Parameter added successfully',errorMessage:"", data: data1[0]});
        } catch (error) {
            console.error('Error executing query', error);
            res.render('./committee/criteriaSelect', {successMessage:"", errorMessage: 'Error inserting data. Please try again.',  data: data1[0] });
        }
    });
    



















export default router;




