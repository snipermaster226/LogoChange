import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { logger } from "@vendetta";

const RestAPI = findByProps("get", "post", "del", "patch");
const GuildStore = findByProps("getGuild");
const UserStore = findByProps("getCurrentUser");

const MANAGE_GUILD = 1n << 5n;

function hasManageGuild(guildId: string): boolean {
    try {
        const guild = GuildStore?.getGuild?.(guildId);
        if (!guild) return false;

        const currentUser = UserStore?.getCurrentUser?.();
        if (guild.ownerId === currentUser?.id || guild.owner_id === currentUser?.id) return true;

        const PermissionStore = findByProps("getGuildPermissions");
        const perms = PermissionStore?.getGuildPermissions?.(guildId);
        if (typeof perms === "bigint" || typeof perms === "number") {
            return (BigInt(perms) & MANAGE_GUILD) === MANAGE_GUILD;
        }
        return false;
    } catch (e) {
        logger.warn("[ServerIcon] Permission check failed:", e);
        return true;
    }
}

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

async function setServerIcon(guildId: string, imageUrl: string) {
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
}

let patches: (() => void)[] = [];

function getImageFromMessage(message: any): string | null {
    const attachment = message?.attachments?.find((a: any) =>
        a?.content_type?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a?.url ?? "")
    );
    if (attachment?.url) return attachment.url;

    const embed = message?.embeds?.find((e: any) => e?.image?.url || e?.thumbnail?.url);
    if (embed) return embed.image?.url ?? embed.thumbnail?.url;

    return null;
}

export default {
    onLoad() {
        const ActionSheetUtils =
            findByProps("showMessageOptionsSheet") ??
            findByProps("showSimpleActionSheet");

        if (!ActionSheetUtils) {
            logger.warn("[ServerIcon] Action sheet module not found.");
            return;
        }

        const methodName = ActionSheetUtils.showMessageOptionsSheet
            ? "showMessageOptionsSheet"
            : "showSimpleActionSheet";

        const unpatch = before(methodName, ActionSheetUtils, (args: any[]) => {
            const opts: any = args[0];
            if (!opts?.options) return;

            const message = opts.message ?? opts.options?.[0]?.message;
            if (!message) return;

            const guildId: string = message.guild_id;
            if (!guildId) return;

            const imageUrl = getImageFromMessage(message);
            if (!imageUrl) return;

            opts.options.push({
                label: "Set as Server Icon",
                action: () => {
                    if (!hasManageGuild(guildId)) {
                        showToast("You need the Manage Server permission to do this.", getAssetIDByName("failure-header"));
                        return;
                    }
                    setServerIcon(guildId, imageUrl);
                },
            });
        });

        patches.push(unpatch);
        logger.log("[ServerIcon] Loaded.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        logger.log("[ServerIcon] Unloaded.");
    },
};
