import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`KFC fake ordering API is running on ${config.appBaseUrl}`);
});
