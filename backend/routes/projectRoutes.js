const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createProject, listProjects, getProject, inviteMembers, acceptInvite, archiveProject, deleteProject, updateProject } = require('../controllers/projectController');

router.use(auth);
router.post('/', createProject);
router.get('/', listProjects);
router.get('/:id', getProject);
router.put('/:id', updateProject);
router.post('/:id/invite', inviteMembers);
router.post('/:id/accept', acceptInvite);
router.post('/:id/archive', archiveProject);
router.delete('/:id', deleteProject);

module.exports = router;