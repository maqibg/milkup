import { getPlatform, PlatformType } from "@/shared/utils/platform";

export const isWindows = getPlatform() === PlatformType.Windows;
