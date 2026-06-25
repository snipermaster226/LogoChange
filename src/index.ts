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
const ChannelStore = findByProps("getChannel");
const IconUtils = findByProps("getGuildIconURL");

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
    logger.log("[ServerIcon] setLocalIcon CALLED guildId=" + guildId + " url=" + imageUrl);
    logger.log("[ServerIcon] storage.overrides now=" + JSON.stringify(storage.overrides));
    showToast("✅ Server icon changed locally!");
}

let unpatchOpenLazy: (() => void) | null = null;
let unpatchIconUrl: (() => void) | null = null;

export default {
    onLoad() {
        storage.overrides ??= {};

        if (IconUtils) {
            logger.log("[ServerIcon] IconUtils methods: " + Object.keys(IconUtils).join(", "));
        } else {
            logger.warn("[ServerIcon] IconUtils not found at all!");
        }

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
                            logger.log("[ServerIcon] Button pressed! guildId=" + guildId);
                            ActionSheet.hideActionSheet();
                            setLocalIcon(guildId, imageUrl);
                        },
                    });

                    groups.splice(0, 0, React.createElement(ActionSheetRow.Group, null, setIconButton));
                });
            });
        });

        if (IconUtils?.getGuildIconURL) {
            const original = IconUtils.getGuildIconURL;
            IconUtils.getGuildIconURL = function (...args: any[]) {
                const guildLike = args[0];
                const guildId = guildLike?.id ?? guildLike?.guild_id;
                const override = guildId ? storage.overrides?.[guildId] : null;
                logger.log("[ServerIcon] getGuildIconURL called, guildId=" + guildId + " hasOverride=" + !!override);
                if (override) return override;
                return original.apply(this, args);
            };

            unpatchIconUrl = () => {
                IconUtils.getGuildIconURL = original;
            };
        }

        logger.log("[ServerIcon] Loaded.");
    },

    onUnload() {
        unpatchOpenLazy?.();
        unpatchIconUrl?.();
        unpatchOpenLazy = null;
        unpatchIconUrl = null;
        logger.log("[ServerIcon] Unloaded.");
    },
};
