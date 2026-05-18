import axios from 'axios';

export const AI_API_BASE_URL = 'http://localhost:4000';

const aiApi = axios.create({
  baseURL: AI_API_BASE_URL,
});

// 기존 client.js 와 동일한 패턴: 토큰 자동 첨부
aiApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default aiApi;
