const express = require('express');
const router = express.Router();
const { register, login, requestPasswordReset, resetPassword, verifyResetOtp } = require('../controllers/authController');
const { mailProviderStatus, sendMail } = require('../utils/emailService');

router.post('/register', register);
router.post('/login', login);
router.post('/request-password-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);
router.post('/verify-reset-otp', verifyResetOtp);

// Diagnostics: check mail provider mode
router.get('/mail-health', (req, res) => {
	try { return res.json(mailProviderStatus()); } catch (e) { return res.status(500).json({ message: e.message }); }
});

// Diagnostics: send a test email (accepts { to })
router.post('/mail-test', async (req, res) => {
	try {
		const to = req.body?.to;
		if (!to) return res.status(400).json({ message: 'Thiếu to' });
		const r = await sendMail({ to, subject: 'Taskly - Test Email', text: 'Đây là email test từ Taskly', html: '<b>Đây là email test từ Taskly</b>' });
		return res.json({ ok: true, result: r, error: r?.error || null });
	} catch (e) { return res.status(500).json({ message: e.message }); }
});

module.exports = router;