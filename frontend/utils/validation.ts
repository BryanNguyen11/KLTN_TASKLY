// Chỉ chấp nhận email @gmail.com
export const validateEmail = (email: string) => /^(?=.{3,}@gmail\.com$)[A-Za-z0-9._%+-]+@gmail\.com$/i.test(email.trim());
// Mật khẩu tối thiểu 8 ký tự
export const validatePassword = (pwd: string) => (pwd || "").length >= 8;
