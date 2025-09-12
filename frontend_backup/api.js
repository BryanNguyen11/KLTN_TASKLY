import axios from 'axios';

export default axios.create({
  baseURL: 'http://localhost:5000', // Khi deploy sẽ đổi sang URL Vercel
});