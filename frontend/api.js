import axios from 'axios';

// Use Expo public env for API base; fall back to local dev port 5050
const API_BASE = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:5050';

export default axios.create({
  baseURL: API_BASE,
});