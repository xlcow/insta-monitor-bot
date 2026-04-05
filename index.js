require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const cron = require("node-cron");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const DATA_FILE = "./data/users.json";
let users = [];

// Load / Save
function loadUsers() {
  try {
    users = JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    users = [];
  }
}
function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

// Add user
function addUser(newUser) {
  if (!users.find(u => u.username === newUser.username && u.mode === newUser.mode)) {
    users.push(newUser);
    saveUsers();
  }
}

//////////////////////////////////////////////////////////////////
// 🔥 FINAL CHECK FUNCTION (NO FALSE RESULTS)
//////////////////////////////////////////////////////////////////
async function checkInstagram(username, old = {}) {
  try {
    const res = await axios.get(
      `https://www.instagram.com/${username}/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: 8000,
      }
    );

    const html = res.data;

    // 🔴 BAN DETECTION (VERY STRICT)
    if (
      html.includes("Sorry, this page isn't available") ||
      html.includes("Page Not Found") ||
      html.length < 10000 // blocked / empty response
    ) {
      return {
        status: "banned",
        followers: old.followers,
        profilePic: old.profilePic,
      };
    }

    // 🟢 ACTIVE DETECTION
    const descMatch = html.match(/property="og:description" content="([^"]+)"/);
    const imgMatch = html.match(/property="og:image" content="([^"]+)"/);

    let followers = old.followers;
    let profilePic = old.profilePic;

    if (descMatch) {
      const match = descMatch[1].match(/([\d,.]+)\sFollowers/);
      if (match) {
        followers = parseInt(match[1].replace(/,/g, ""));
      }
    }

    if (imgMatch) {
      profilePic = imgMatch[1];
    }

    return {
      status: "active",
      followers,
      profilePic,
    };

  } catch {
    return {
      status: old.status || "unknown",
      followers: old.followers,
      profilePic: old.profilePic,
    };
  }
}

//////////////////////////////////////////////////////////////////

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  loadUsers();
});

//////////////////////////////////////////////////////////////////
// COMMANDS
//////////////////////////////////////////////////////////////////
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args[0];

  if (cmd === "!ban" || cmd === "!unban") {
    const username = args[1];
    if (!username) return;

    const result = await checkInstagram(username);

    message.channel.send(
      `Tracking started for @${username}\nCurrent Status: ${
        result.status === "active" ? "🟢 ACTIVE" : "🔴 BANNED"
      }`
    );

    addUser({
      username,
      mode: cmd === "!ban" ? "ban" : "unban",
      lastStatus: result.status,
      bannedAt: result.status === "banned" ? Date.now() : null,
      followers: result.followers,
      profilePic: result.profilePic,
    });
  }
});

//////////////////////////////////////////////////////////////////
// 🔁 MONITOR LOOP (EVERY MINUTE)
//////////////////////////////////////////////////////////////////
cron.schedule("* * * * *", async () => {
  const channel = client.channels.cache.get(process.env.CHANNEL_ID);
  if (!channel) return;

  for (let user of users) {
    const result = await checkInstagram(user.username, user);

    if (result.status === "unknown") continue;

    if (result.followers) user.followers = result.followers;
    if (result.profilePic) user.profilePic = result.profilePic;

    //////////////////////////////////////////////////////////////
    // 🔴 BAN DETECT
    //////////////////////////////////////////////////////////////
    if (
      user.mode === "ban" &&
      result.status === "banned" &&
      user.lastStatus === "active"
    ) {
      user.bannedAt = Date.now();

      channel.send(`🚨 Monitoring Status: Account BANNED | @${user.username} 🔴
────────────────────────────`);
    }

    //////////////////////////////////////////////////////////////
    // 🟢 UNBAN DETECT
    //////////////////////////////////////////////////////////////
    if (
      user.mode === "unban" &&
      result.status === "active" &&
      user.lastStatus === "banned"
    ) {
      const t = Date.now() - user.bannedAt;

      const h = Math.floor(t / 3600000);
      const m = Math.floor((t % 3600000) / 60000);
      const s = Math.floor((t % 60000) / 1000);

      channel.send(`Monitoring Status: Account Recovered | @${user.username} 🏆✅
🏆✅ | Followers: ${user.followers?.toLocaleString() || "Hidden"}
⏱ Time taken: ${h} hours, ${m} minutes, ${s} seconds
────────────────────────────`);
    }

    user.lastStatus = result.status;
    saveUsers();

    await new Promise(r => setTimeout(r, 4000));
  }
});

//////////////////////////////////////////////////////////////////

client.login(process.env.TOKEN);