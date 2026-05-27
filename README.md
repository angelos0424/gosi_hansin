# 목사고시 기출문제

## Coolify 배포

- Build command: `npm run build`
- Start command: `npm start`
- Environment:
  - `DATA_DIR=/data`
- Persistent storage:
  - Mount path: `/data`

풀이 기록은 `${DATA_DIR}/progress.sqlite`에 저장됩니다. Coolify에서 `/data`를 persistent volume으로 마운트해야 재배포 후에도 학습 기록이 유지됩니다.
