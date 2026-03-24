import { execSync } from 'child_process';
import path from 'path';

export default async function globalSetup() {
  const backendDir = path.resolve(__dirname, '../backend');

  console.log('[global-setup] Rails test DB 초기화...');
  execSync('bundle exec rails db:reset RAILS_ENV=test', {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, RAILS_ENV: 'test' },
  });
  console.log('[global-setup] DB 초기화 완료');
}
