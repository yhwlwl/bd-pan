import http from 'k6/http';
import { sleep, check } from 'k6';

// 这里的配置决定了压力的大小
export const options = {
  stages: [
    { duration: '10s', target: 20 }, // 前30秒，并发用户从 0 增加到 20 人
    { duration: '10s', target: 50 },  // 接下来1分钟，保持 50 个并发用户快速访问
    { duration: '10s', target: 0 },  // 最后30秒，用户数降回 0，测试结束
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'], // 要求失败率低于 5%
    http_req_duration: ['p(95)<2000'], // 要求 95% 的请求在 2 秒内得到响应
  },
};

export default function () {
  // --- ⚠️ 请在这里替换成你的线上 Vercel 网址或本地地址 ---
  const BASE_URL = 'http://pan.cdqzsta.tech'; // 如果测本地
  // const BASE_URL = 'https://你的域名.vercel.app'; // 如果测线上

  const url = `${BASE_URL}/api/alist`;
  
  // 模拟请求 AList 根目录的文件列表
  const payload = JSON.stringify({
    action: 'list',
    path: '/'
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      // 如果你在 api 加入了身份认证，记得这里也要带上 token
    },
  };

  const res = http.post(url, payload, params);

  // 验证返回状态是否是 200
  check(res, {
    'is status 200': (r) => r.status === 200,
    'has data': (r) => r.json().code === 200,
  });

  // 每个虚拟用户请求后休息 1-2 秒，模拟真人操作
  sleep(Math.random() * 1 + 1);
}
