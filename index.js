import { Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Routes, REST } from "discord.js"
import dotenv from "dotenv"
dotenv.config()

const env = k => (process.env[k]?.trim?.() ?? null)
const TOKEN = env("TOKEN")
const CLIENT_ID = env("CLIENT_ID")
const ADMIN_ROLE_ID = env("ADMIN_ROLE_ID")
const PANEL_IMAGE_URL = env("PANEL_IMAGE_URL") || "https://i.imgur.com/2nL4D94.png"
const PANEL_CHANNEL_ID = env("PANEL_CHANNEL_ID")
const TICKETS_CATEGORY_ID = env("TICKETS_CATEGORY_ID")
const CATEGORY_SUPPORT_ID = env("CATEGORY_SUPPORT_ID")
const CATEGORY_DOACOES_ID = env("CATEGORY_DOACOES_ID")
const CATEGORY_APELACAO_ID = env("CATEGORY_APELACAO_ID")
const LOG_CHANNEL_ID = env("LOG_CHANNEL_ID")

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], partials: [Partials.Channel] })

const kinds = [
  { key: "support", label: "Suporte", emoji: "🛠️", cat: () => CATEGORY_SUPPORT_ID || TICKETS_CATEGORY_ID || null },
  { key: "doacoes", label: "Doações", emoji: "💸", cat: () => CATEGORY_DOACOES_ID || TICKETS_CATEGORY_ID || null },
  { key: "apelacao", label: "Apelação", emoji: "⚖️", cat: () => CATEGORY_APELACAO_ID || TICKETS_CATEGORY_ID || null }
]

const makePanel = () => {
  const embed = new EmbedBuilder().setTitle("Atendimento").setDescription("Escolha abaixo o motivo para abrir seu ticket.").setImage(PANEL_IMAGE_URL).setColor(0x2b2d31)
  const row = new ActionRowBuilder().addComponents(...kinds.map(k => new ButtonBuilder().setCustomId(`open_${k.key}`).setLabel(k.label).setEmoji(k.emoji).setStyle(ButtonStyle.Primary)))
  return { embed, row }
}

const log = async (guild, msg) => {
  console.log(`[tickets] ${msg}`)
  if (!LOG_CHANNEL_ID) return
  const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null)
  if (ch) await ch.send({ content: `\`\`\`${msg}\`\`\`` }).catch(() => {})
}

const resolveCategory = async (guild, id) => {
  if (!id) return { parent: null, reason: "sem_id" }
  const ch = await guild.channels.fetch(id).catch(() => null)
  if (!ch) return { parent: null, reason: "nao_encontrada" }
  if (ch.type !== ChannelType.GuildCategory) return { parent: null, reason: "nao_e_categoria" }
  const me = guild.members.me
  const ok = me.permissionsIn(ch).has(PermissionsBitField.Flags.ManageChannels)
  if (!ok) return { parent: null, reason: "sem_permissao_manage_channels" }
  return { parent: ch, reason: "ok" }
}

client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN)
  const commands = [{ name: "ticketsetup", description: "Enviar o painel de tickets neste canal" }]
  for (const gid of [...client.guilds.cache.keys()]) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, gid), { body: commands })
  if (PANEL_CHANNEL_ID) {
    const ch = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null)
    if (ch) {
      const { embed, row } = makePanel()
      await ch.send({ embeds: [embed], components: [row] }).catch(() => {})
    }
  }
  console.log(`on ${client.user.tag}`)
})

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "ticketsetup") {
      const member = await interaction.guild.members.fetch(interaction.user.id)
      const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator) || (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID))
      if (!isAdmin) return await interaction.reply({ content: "Sem permissão.", ephemeral: true })
      const { embed, row } = makePanel()
      await interaction.channel.send({ embeds: [embed], components: [row] })
      return await interaction.reply({ content: "Painel enviado.", ephemeral: true })
    }

    if (!interaction.isButton()) return
    if (!interaction.customId.startsWith("open_")) return

    const key = interaction.customId.replace("open_", "")
    const kind = kinds.find(k => k.key === key)
    if (!kind) return

    const existing = interaction.guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.topic === interaction.user.id)
    if (existing) return await interaction.reply({ content: `Você já tem um ticket aberto: ${existing}`, ephemeral: true })

    const wantParentId = kind.cat()
    const { parent, reason } = await resolveCategory(interaction.guild, wantParentId)
    await log(interaction.guild, `abrir ticket key=${key} user=${interaction.user.id} wantParent=${wantParentId} resolved=${parent?.id || "null"} reason=${reason}`)

    const name = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}-${Math.floor(Math.random() * 1000)}`
    const overwrites = [
      { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
    ]
    if (ADMIN_ROLE_ID) overwrites.push({ id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] })

    let channel = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parent?.id ?? null,
      topic: interaction.user.id,
      permissionOverwrites: overwrites
    }).catch(async err => {
      await log(interaction.guild, `falha create parent=${parent?.id || "null"} code=${err?.code || "?"} msg=${err?.message || "?"}`)
      return null
    })

    if (!channel) return await interaction.reply({ content: "Falha ao criar o canal do ticket. Veja os logs.", ephemeral: true })

    if (parent && channel.parentId !== parent.id) {
      const moved = await channel.setParent(parent.id).then(() => true).catch(async err => {
        await log(interaction.guild, `falha mover channel=${channel.id} para parent=${parent.id} code=${err?.code || "?"}`)
        return false
      })
      await log(interaction.guild, `mover resultado=${moved} channel.parent=${channel.parentId}`)
    }

    const openEmbed = new EmbedBuilder().setTitle(`Ticket • ${kind.label}`).setDescription(`<@${interaction.user.id}> aguarde um atendente. Use o botão abaixo para fechar quando resolver.`).setColor(0x2b2d31)
    const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket_close").setLabel("Fechar").setEmoji("🔒").setStyle(ButtonStyle.Danger))
    const pingAdmins = ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}>` : ""
    await channel.send({ content: pingAdmins, embeds: [openEmbed], components: [closeRow] })
    await interaction.reply({ content: `Ticket criado: ${channel}`, ephemeral: true })
  } catch (e) {
    try { await interaction.reply({ content: "Erro inesperado ao abrir o ticket.", ephemeral: true }) } catch {}
    try { await log(interaction.guild, `erro inesperado: ${e?.message || e}`) } catch {}
  }
})

client.login(TOKEN)
