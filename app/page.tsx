import { getChatGPTUser } from './chatgpt-auth';
import { AppShell } from '@/components/app-shell';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  return <AppShell userName={user?.displayName ?? '로컬 데모 사용자'} />;
}
