import { findByProps } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { logger } from "@vendetta";
import { React } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import { storage } from "@vendetta/plugin";

const ActionSheet = findByProps("openLazy", "hideActionSheet");
const { ActionSheetRow } = findByProps("ActionSheetRow");
const GuildStore = findByProps("getGuild");
const ChannelStore = findByProps("getChannel");

const ImageIcon =
    getAssetIDByName("ic_image") ??
    getAssetIDByName("ImageIcon") ??
    getAssetIDByName("ic_image_24px");

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

function setLocalIcon(guildId: string, imageUrl: string) {
    storage.overrides ??= {};
    storage.overrides[guildId] = imageUrl;
    showToast("✅ Server icon changed locally!");
}

let unpatchOpenLazy: (() => void) | null = null;
let unpatchGuildIcon: (() => void) | null = null;

export default {
    onLoad() {
        storage.overrides ??= {};

        // Patch the long-press action sheet to add our option
        unpatchOpenLazy = before("openLazy", ActionSheet, ([comp, args, msg]) => {
            if (args !== "MessageLongPressActionSheet" || !msg?.message) return;

            const message = msg.message;
            const guildId = resolveGuildId(message);
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
                        label: "Set as Server Icon (Local Only)",
                        icon: React.createElement(ActionSheetRow.Icon, { source: ImageIcon }),
                        onPress: () => {
                            ActionSheet.hideActionSheet();
                            setLocalIcon(guildId, imageUrl);
                        },
                    });

                    groups.splice(0, 0, React.createElement(ActionSheetRow.Group, null, setIconButton));
                });
            });
        });

        // Patch GuildStore.getGuild to inject our fake icon into the guild object
        unpatchGuildIcon = after("getGuild", GuildStore, (args: any[], guild: any) => {
            if (!guild) return guild;
            const override = storage.overrides?.[guild.id];
            if (override) {
                // Mutate a clone so we don't corrupt the real cached object
                return { ...guild, icon: override, __localIconOverride: true, __localIconUrl: override };
            }
            return guild;
        });

        logger.log("[ServerIcon] Loaded.");
    },

    onUnload() {
        unpatchOpenLazy?.();
        unpatchGuildIcon?.();
        unpatchOpenLazy = null;
        unpatchGuildIcon = null;
        logger.log("[ServerIcon] Unloaded.");
    },
};
