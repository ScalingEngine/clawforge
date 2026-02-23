import { auth } from 'clawforge/auth';
import { SettingsLayout } from 'clawforge/chat';

export default async function Layout({ children }) {
  const session = await auth();
  return <SettingsLayout session={session}>{children}</SettingsLayout>;
}
