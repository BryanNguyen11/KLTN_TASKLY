const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createProject, listProjects, getProject, inviteMembers, acceptInvite, archiveProject, deleteProject, updateProject, updateMemberRole, removeMember, revokeInvite, leaveProject } = require('../controllers/projectController');

router.use(auth);
router.post('/', createProject);
router.get('/', listProjects);
router.get('/:id', getProject);
router.put('/:id', updateProject);
router.post('/:id/invite', inviteMembers);
router.post('/:id/accept', acceptInvite);
router.put('/:id/members/:userId/role', updateMemberRole);
router.delete('/:id/members/:userId', removeMember);
router.delete('/:id/invites/:inviteId', revokeInvite);
router.post('/:id/leave', leaveProject);
router.post('/:id/archive', archiveProject);
router.delete('/:id', deleteProject);

module.exports = router;