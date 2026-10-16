import { ImageResponse } from 'next/og';
import { VirtualBackgroundArt, isVirtualBackgroundId } from '@/lib/virtual-backgrounds';

export const VIRTUAL_BACKGROUND_SIZE = { width: 1920, height: 1080 };

/** バーチャル背景をフルHDのPNGとして返す（Zoom 推奨の 16:9）。 */
export function renderVirtualBackgroundPng(id: string, fileName: string) {
  if (!isVirtualBackgroundId(id)) throw new Error('virtual-background-not-found');
  const { width, height } = VIRTUAL_BACKGROUND_SIZE;
  return new ImageResponse(<VirtualBackgroundArt id={id} width={width} height={height} />, {
    width,
    height,
    headers: {
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
