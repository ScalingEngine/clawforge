import { auth } from 'clawforge/auth';
import { SwarmPage } from 'clawforge/chat';

export default async function SwarmRoute() {
  const session = await auth();
  return <SwarmPage session={session} />;
}
