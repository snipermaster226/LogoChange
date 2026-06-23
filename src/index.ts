import { findByProps } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { logger } from "@vendetta";
import { React } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";

const ActionSheet = findByProps("openLazy", "hideActionSheet");
const { ActionSheetRow } = findByProps("ActionSheetRow");
const RestAPI = findByProps("get", "post", "del", "patch");
const GuildStore = findByProps("getGuild");
const UserStore = findByProps("getCurrentUser");
const ChannelStore = findByProps("getChannel");

const ImageIcon =
    getAssetIDByName("ic_image") ??
    getAssetIDByName("ImageIcon") ??
    getAssetIDByName("ic_image_24px");

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
        logger.warn("[ServerIcon] Permission check failed: " + String(e));
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
    showToast("Updating server icon...");
    try {
        const base64 = await imageUrlToBase64(imageUrl);
        await RestAPI.patch({ url: `/guilds/${guildId}`, body: { icon: base64 } });
        showToast("✅ Server icon updated!");
    } catch (err) {
        logger.log("[ServerIcon] Failed to update icon: " + String(err));
        showToast("❌ Failed to update server icon.");
    }
}

function getImageFromMessage(message: any): string | null {
    const attachment = message?.attachments?.find((a: any) =>
        a?.content_type?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a?.url ?? "")
    );
    if (attachment?.url) return attachment.url;
    const embed = message?.embeds?.find((e: any) => e?.image?.url || e?.thumbnail?.url);
    if (embed) return embed.image?.url ?? embed.thumbnail?.url;
    return null;
}

function resolveGuildId(message: any): string | null {
    if (message.guild_id) return message.guild_id;
    const channel = ChannelStore?.getChannel?.(message.channel_id);
    return channel?.guild_id ?? null;
}

let unpatchOpenLazy: (() => void) | null = null;

export default {
    onLoad() {
        unpatchOpenLazy = before("openLazy", ActionSheet, ([comp, args, msg]) => {
            if (args !== "MessageLongPressActionSheet" || !msg?.message) return;

            const message = msg.message;
            const guildId = resolveGuildId(message);
            logger.log("[ServerIcon] resolved guild_id=" + guildId);
            if (!guildId) return;

            const imageUrl = getImageFromMessage(message);
            if (!imageUrl) return;

            comp.then((instance: any) => {
                const unpatch = after("default", instance, (_: any, component: any) => {
                    React.useEffect(() => () => { unpatch(); }, []);

                    const groups: any[] = findInReactTree(
                        component,
                        (c: any) => Array.isArray(c) && c[0]?.type?.name === "ActionSheetRowGroup"
                    );
                    if (!groups?.length) return;

                    const setIconButton = React.createElement(ActionSheetRow, {
                        label: "Set as Server Icon",
                        icon: React.createElement(ActionSheetRow.Icon, { source: ImageIcon }),
                        onPress: () => {
                            ActionSheet.hideActionSheet();
                            if (!hasManageGuild(guildId)) {
                                showToast("You need the Manage Server permission to do this.");
                                return;
                            }
                            setServerIcon(guildId, imageUrl);
                        },
                    });

                    groups.splice(0, 0, React.createElement(ActionSheetRow.Group, null, setIconButton));
                });
            });
        });

        logger.log("[ServerIcon] Loaded.");
    },

    onUnload() {
        unpatchOpenLazy?.();
        unpatchOpenLazy = null;
        logger.log("[ServerIcon] Unloaded.");
    },
};
