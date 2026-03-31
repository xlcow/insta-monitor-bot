require("dotenv").config();

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
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

// Load/save
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

// Add user safely
function addUser(newUser) {
  if (!users.find(u => u.username === newUser.username && u.mode === newUser.mode)) {
    users.push(newUser);
    saveUsers();
  }
}

// 🔥 ADVANCED CHECK
async function checkInstagram(username, old = {}) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await axios.get(
        `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            "x-ig-app-id": "936619743392459",
            "accept-language": "en-US,en;q=0.9",
            "referer": "https://www.instagram.com/",
            "Cookie": `sessionid=${process.env.IG_SESSION};`,
          },
          timeout: 7000,
        }
      );

      const user = res.data.data.user;

      if (!user) return { status: "banned" };

      return {
        status: "active",
        followers: user.edge_followed_by.count,
        profilePic: user.profile_pic_url_hd,
      };

    } catch {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  return {
    status: "error",
    followers: old.followers || null,
    profilePic: old.profilePic || null,
  };
}

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  loadUsers();
});

// Profile card
function sendCard(channel, username, result) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`@${username}`)
    .setDescription(
      result.status === "active"
        ? `🟢 ACTIVE\n👥 ${result.followers ? result.followers.toLocaleString() : "Hidden"} followers`
        : `🔴 BANNED`
    )
    .setThumbnail(
      result.profilePic ||
      "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    );

  channel.send({ embeds: [embed] });
}

// Commands
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args[0];

  if (cmd === "!ban" || cmd === "!unban") {
    const usernames = args[1] === "list" ? args.slice(2) : [args[1]];

    for (let username of usernames) {
      if (!username) continue;

      const result = await checkInstagram(username);
      sendCard(message.channel, username, result);

      addUser({
        username,
        mode: cmd === "!ban" ? "ban" : "unban",
        lastStatus: result.status,
        bannedAt: result.status === "banned" ? Date.now() : null,
        followers: result.followers,
        profilePic: result.profilePic,
      });

      await new Promise(r => setTimeout(r, 2000));
    }
  }
});

// Monitor loop
cron.schedule("* * * * *", async () => {
  const channel = client.channels.cache.get(process.env.CHANNEL_ID);
  if (!channel) return;

  for (let user of users) {
    const result = await checkInstagram(user.username, user);

    if (result.status === "error") continue;

    if (result.followers) user.followers = result.followers;
    if (result.profilePic) user.profilePic = result.profilePic;

    // BAN DETECT
    if (user.mode === "ban" && result.status === "banned" && user.lastStatus !== "banned") {
      user.bannedAt = Date.now();
      channel.send(`🚨 **Account BANNED | @${user.username} 🔴**`);
    }

    // UNBAN DETECT
    if (user.mode === "unban" && result.status === "active" && user.lastStatus === "banned") {
      const t = Date.now() - user.bannedAt;

      const h = Math.floor(t / 3600000);
      const m = Math.floor((t % 3600000) / 60000);
      const s = Math.floor((t % 60000) / 1000);

      await channel.send(
        `**Account Recovered | @${user.username} 🏆✅**\n*Followers: ${
          user.followers ? user.followers.toLocaleString() : "Hidden"
        } | ⏱ ${h}h ${m}m ${s}s*`
      );

      sendCard(channel, user.username, user);
    }

    user.lastStatus = result.status;
    saveUsers();

    await new Promise(r => setTimeout(r, 4000));
  }
});

client.login(process.env.TOKEN);