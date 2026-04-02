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

// Add user
function addUser(newUser) {
  if (!users.find(u => u.username === newUser.username && u.mode === newUser.mode)) {
    users.push(newUser);
    saveUsers();
  }
}

// 🔥 SAFE INSTAGRAM CHECK (NO FALSE BANS)
async function checkInstagram(username, old = {}) {
  try {
    const res = await axios.get(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "x-ig-app-id": "936619743392459",
          "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: 7000,
      }
    );

    const user = res.data?.data?.user;

    if (!user) {
      return {
        status: old.status || "unknown",
        followers: old.followers || null,
        profilePic: old.profilePic || null,
      };
    }

    return {
      status: "active",
      followers: user.edge_followed_by?.count || old.followers,
      profilePic: user.profile_pic_url_hd || old.profilePic,
    };

  } catch (err) {

    if (err.response?.status === 404) {
      return { status: "banned" };
    }

    return {
      status: old.status || "unknown",
      followers: old.followers || null,
      profilePic: old.profilePic || null,
    };
  }
}

// Ready
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
        : result.status === "banned"
        ? `🔴 BANNED`
        : `⚠️ CHECKING...`
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
        lastStatus: result.status || "unknown",
        bannedAt: result.status === "banned" ? Date.now() : null,
        followers: result.followers || null,
        profilePic: result.profilePic || null,
      });

      await new Promise(r => setTimeout(r, 2000));
    }
  }
});

// 🔁 MONITOR LOOP
cron.schedule("* * * * *", async () => {
  const channel = client.channels.cache.get(process.env.CHANNEL_ID);
  if (!channel) return;

  for (let user of users) {
    const result = await checkInstagram(user.username, user);

    if (result.status === "unknown") continue;

    if (result.followers) user.followers = result.followers;
    if (result.profilePic) user.profilePic = result.profilePic;

    // 🔴 BAN DETECT
    if (
      user.mode === "ban" &&
      result.status === "banned" &&
      user.lastStatus === "active"
    ) {
      user.bannedAt = Date.now();

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle(`Account BANNED | @${user.username} 🔴`)
        .setThumbnail(user.profilePic)
        .setTimestamp();

      channel.send({ embeds: [embed] });
    }

    // 🟢 UNBAN DETECT
    if (
      user.mode === "unban" &&
      result.status === "active" &&
      user.lastStatus === "banned"
    ) {
      const t = Date.now() - user.bannedAt;

      const h = Math.floor(t / 3600000);
      const m = Math.floor((t % 3600000) / 60000);
      const s = Math.floor((t % 60000) / 1000);

      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle(`Account Recovered | @${user.username} 🏆✅`)
        .setDescription(
          `**Followers:** ${
            user.followers ? user.followers.toLocaleString() : "Hidden"
          }\n⏱ **Time taken:** ${h}h ${m}m ${s}s`
        )
        .setThumbnail(user.profilePic)
        .setTimestamp();

      await channel.send({
        content: `Account Recovered | @${user.username} 🏆✅`,
        embeds: [embed],
      });
    }

    user.lastStatus = result.status;
    saveUsers();

    await new Promise(r => setTimeout(r, 4000));
  }
});

client.login(process.env.TOKEN);