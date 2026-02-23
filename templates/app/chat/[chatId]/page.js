import { auth } from 'clawforge/auth';
import { ChatPage } from 'clawforge/chat';

export default async function ChatRoute({ params }) {
  const { chatId } = await params;
  const session = await auth();
  return <ChatPage session={session} needsSetup={false} chatId={chatId} />;
}
