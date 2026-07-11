import { createApp } from "./app.js";
import { config } from "./config.js";
import { initializeDatabase } from "./lib/database.js";
import { initializeCouponRedemptions } from "./services/coupon-redemptions.js";
import { initializeStoreHours } from "./services/store.js";
import { configureTelegramBotCommands } from "./services/telegram.js";

async function start() {
  await initializeDatabase();
  await initializeStoreHours();
  await initializeCouponRedemptions();
  await configureTelegramBotCommands();
  const app = createApp();

  app.listen(config.port, () => {
    console.log(`KFC ordering API is running on ${config.appBaseUrl}`);
  });
}

start().catch((error) => {
  console.error("Unable to start KFC ordering API.", error);
  process.exitCode = 1;
});
