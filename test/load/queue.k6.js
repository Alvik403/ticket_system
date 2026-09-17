import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 20 },
    { duration: '40s', target: 100 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const baseUrl = __ENV.API_URL || 'http://localhost:3000/api';

export default function () {
  const sites = http.get(`${baseUrl}/public/sites`);
  check(sites, { 'sites returns 200': (response) => response.status === 200 });
  if (sites.status !== 200) return;
  const site = sites.json()[0];
  const services = http.get(`${baseUrl}/public/sites/${site.id}/services`);
  check(services, {
    'services returns 200': (response) => response.status === 200,
  });
  sleep(1);
}

