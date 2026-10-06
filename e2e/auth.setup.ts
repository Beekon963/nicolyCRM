import { test as setup } from "@playwright/test";
import { SEED_USERS } from "../scripts/seed/constants.mts";
import { loginWithMagicLink } from "./helpers/auth";

// オーナー・管理者のログイン状態を保存して、ほかのテストで使い回す
for (const role of ["owner", "manager"] as const) {
  setup(`${role} でログイン`, async ({ page }) => {
    await loginWithMagicLink(page, SEED_USERS[role].email);
    await page.context().storageState({ path: `e2e/.auth/${role}.json` });
  });
}
