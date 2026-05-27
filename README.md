# 목사고시 기출문제

## Coolify 배포

- Build command: `npm run build`
- Start command: `npm start`
- Build pack: Nixpacks
- Environment:
  - `DATA_DIR=/data`
  - `NIXPACKS_NODE_VERSION=22`
- Persistent storage:
  - Mount path: `/data`

풀이 기록은 `${DATA_DIR}/progress.sqlite`에 저장됩니다. Coolify에서 `/data`를 persistent volume으로 마운트해야 재배포 후에도 학습 기록이 유지됩니다.

`/api/progress/{id}` 요청이 `index.html`을 반환하거나 `PUT` 요청이 `405 Allow: GET, HEAD`로 실패하면 Node 서버가 아니라 정적 Caddy 서버로 배포된 상태입니다. 이 경우 Build Pack을 Nixpacks로 두고 `nixpacks.toml`이 포함된 최신 커밋을 다시 배포하세요.
