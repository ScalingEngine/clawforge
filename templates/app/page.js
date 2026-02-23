import { auth } from '../lib/auth/index.js';
import { ChatPage } from '../lib/chat/components/index.js';

export default async function Home() {
  const session = await auth();
  return <ChatPage session={session} needsSetup={false} />;
}
