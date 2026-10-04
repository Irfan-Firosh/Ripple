import { test, expect, type Page } from '@playwright/test';

// Substitute only Clerk's session boundary; mount the real auth page and routing.
// No credentials, account creation, or external auth service are needed.
async function clerkSession(page: Page, initiallySignedIn = false) {
  await page.route('**/node_modules/.vite/deps/@clerk_react.js*', route => route.fulfill({
    contentType: 'application/javascript', body: `
      import React from '/node_modules/.vite/deps/react.js${new URL(route.request().url()).search}';
      let signedIn = ${initiallySignedIn};
      const listeners = new Set();
      const subscribe = callback => { listeners.add(callback); return () => listeners.delete(callback); };
      export const useAuth = () => ({ isLoaded: true, isSignedIn: React.useSyncExternalStore(subscribe, () => signedIn) });
      export const ClerkProvider = props => React.createElement('div', {
        'data-testid': 'auth-provider', 'data-sign-in-redirect': props.signInForceRedirectUrl,
        'data-sign-up-redirect': props.signUpForceRedirectUrl,
      }, props.children);
      export const Show = props => {
        const auth = useAuth();
        return (props.when === 'signed-in' ? auth.isSignedIn : !auth.isSignedIn) ? props.children : null;
      };
      const form = (label, props) => React.createElement('button', {
        'data-redirect': props.forceRedirectUrl,
        'data-cross-flow-redirect': props.signInForceRedirectUrl ?? props.signUpForceRedirectUrl,
        onClick: () => { signedIn = true; listeners.forEach(callback => callback()); },
      }, label);
      export const SignIn = props => form('Complete sign in', props);
      export const SignUp = props => form('Complete sign up', props);
      export const ClerkLoading = () => null;
      export const ClerkFailed = () => null;
      export const UserButton = () => null;
    `,
  }));
}

for (const [path, action] of [['/auth/sign-in', 'Complete sign in'], ['/auth', 'Complete sign up']]) {
  test(`${path} sends a newly authenticated session straight to onboarding`, async ({ page }) => {
    await clerkSession(page);
    await page.goto(`${path}?redirect_url=/dashboard`);
    const provider = page.getByTestId('auth-provider');
    await expect(provider).toHaveAttribute('data-sign-in-redirect', '/onboarding');
    await expect(provider).toHaveAttribute('data-sign-up-redirect', '/onboarding');
    const button = page.getByRole('button', { name: action });
    await expect(button).toHaveAttribute('data-redirect', '/onboarding');
    await expect(button).toHaveAttribute('data-cross-flow-redirect', '/onboarding');
    await button.click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { name: 'Your brand on X' })).toBeVisible();
  });
}

test('an existing signed-in session on the auth page immediately opens onboarding', async ({ page }) => {
  await clerkSession(page, true);
  await page.goto('/auth/sign-in');
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { name: 'Connect your brand' })).toBeVisible();
});
