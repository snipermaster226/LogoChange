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

let unpatchOpenLazy: (() => void) | null = null;

export default {
    onLoad() {
        if (!ActionSheet) logger.warn("[ServerIcon] ActionSheet module NOT FOUND");
        if (!ActionSheetRow) logger.warn("[ServerIcon] ActionSheetRow NOT FOUND");

        unpatchOpenLazy = before("openLazy", ActionSheet, ([comp, args, msg]) => {
            logger.log("[ServerIcon] openLazy fired with args=" + String(args));

            if (args !== "MessageLongPressActionSheet") {
                logger.log("[ServerIcon] Skipped — wrong sheet type: " + String(args));
                return;
            }
            if (!msg?.message) {
                logger.log("[ServerIcon] Skipped — no message in payload");
                return;
            }

            const message = msg.message;
            logger.log("[ServerIcon] guild_id=" + message.guild_id + " attachments=" + JSON.stringify(message.attachments)?.slice(0, 300));

            const guildId: string = message.guild_id;
            if (!guildId) {
                logger.log("[ServerIcon] Skipped — no guild_id (DM)");
                return;
            }

            const imageUrl = getImageFromMessage(message);
            if (!imageUrl) {
                logger.log("[ServerIcon] Skipped — no image found on message");
                return;
            }

            logger.log("[ServerIcon] Image found, patching action sheet: " + imageUrl);

            comp.then((instance: any) => {
                const unpatch = after("default", instance, (_: any, component: any) => {
                    React.useEffect(() => () => { unpatch(); }, []);

                    const groups: any[] = findInReactTree(
                        component,
                        (c: any) => Array.isArray(c) && c[0]?.type?.name === "ActionSheetRowGroup"
                    );

                    if (!groups?.length) {
                        logger.warn("[ServerIcon] Could not find ActionSheetRowGroups");
                        return;
                    }

                    logger.log("[ServerIcon] Found " + groups.length + " groups, inserting button");

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
