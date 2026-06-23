import { findByProps } from "@vendetta/metro";
import { registerCommand, unregisterAllCommands } from "@vendetta/commands";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { logger } from "@vendetta";

const RestAPI = findByProps("get", "post", "del", "patch");
const PermissionStore = findByProps("getGuildPermissions") ?? findByProps("can");
const GuildStore = findByProps("getGuild");

// Permission bit for MANAGE_GUILD
const MANAGE_GUILD = 1n << 5n;

function hasManageGuild(guildId: string): boolean {
    try {
        const guild = GuildStore?.getGuild?.(guildId);
        if (!guild) return false;

        // Try the permissions store first
        const perms = PermissionStore?.getGuildPermissions?.(guildId);
        if (typeof perms === "bigint" || typeof perms === "number") {
            return (BigInt(perms) & MANAGE_GUILD) === MANAGE_GUILD;
        }

        // Fallback: guild owner always has permission
        const UserStore = findByProps("getCurrentUser");
        const currentUser = UserStore?.getCurrentUser?.();
        if (guild.ownerId === currentUser?.id || guild.owner_id === currentUser?.id) return true;

        return false;
    } catch (e) {
        logger.warn("[ServerIcon] Permission check failed, allowing by default:", e);
        return true; // fail open — Discord's own API will reject it server-side anyway
    }
}

// Convert a fetched image into a base64 data URI
async function imageUrlToBase64(url: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export function loadCommand() {
    registerCommand({
        name: "seticon",
        description: "Change this server's icon using an attached image.",
        options: [
            {
                name: "image",
                description: "The image to set as the new server icon",
                type: 11 /* ATTACHMENT */,
                required: true,
            },
        ],
        execute: async (args: any[], ctx: any) => {
            const guildId: string = ctx?.guild?.id ?? ctx?.channel?.guild_id;

            if (!guildId) {
                showToast("This command only works inside a server.", getAssetIDByName("failure-header"));
                return;
            }

            if (!hasManageGuild(guildId)) {
                showToast("You need the Manage Server permission to do this.", getAssetIDByName("failure-header"));
                return;
            }

            const attachmentArg = args?.find((o) => o.name === "image");
            const attachment = attachmentArg?.attachment ?? attachmentArg?.value;
            const imageUrl: string = attachment?.url ?? attachment?.proxy_url ?? attachment;

            if (!imageUrl || typeof imageUrl !== "string") {
                showToast("Please attach a valid image.", getAssetIDByName("failure-header"));
                return;
            }

            showToast("Updating server icon...", getAssetIDByName("ic_upload_24px"));

            try {
                const base64 = await imageUrlToBase64(imageUrl);

                await RestAPI.patch({
                    url: `/guilds/${guildId}`,
                    body: { icon: base64 },
                });

                showToast("✅ Server icon updated!", getAssetIDByName("check"));
            } catch (err) {
                logger.error("[ServerIcon] Failed to update icon:", err);
                showToast("❌ Failed to update server icon.", getAssetIDByName("failure-header"));
            }
        },
    });
}

export function unloadCommand() {
    unregisterAllCommands();
}

export default {
    onLoad() {
        loadCommand();
        logger.log("[ServerIcon] Loaded.");
    },
    onUnload() {
        unloadCommand();
        logger.log("[ServerIcon] Unloaded.");
    },
};

