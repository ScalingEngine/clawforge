import { auth } from 'clawforge/auth';
import { ChatPage } from 'clawforge/chat';

export default async function Home() {
  const session = await auth();
  return <ChatPage session={session} needsSetup={false} />;
}
