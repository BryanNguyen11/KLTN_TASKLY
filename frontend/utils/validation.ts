export const validateEmail = (email: string) => /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
export const validatePassword = (pwd: string) => pwd.length >= 6;
