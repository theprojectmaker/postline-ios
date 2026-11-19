// iOS Mail palette: white lists, hairline separators, system blue, grouped grey for the sidebar.
import { StyleSheet } from 'react-native';

export const T = {
  bg: '#FFFFFF', group: '#F2F2F7', card: '#FFFFFF', ink: '#000000', text: '#1C1C1E', sub: '#6C6C70', faint: '#8E8E93',
  line: '#D1D1D6', fill: '#7676801F', tint: '#0A84FF', tintDark: '#0060DF', tintSoft: '#E6F1FF',
  red: '#FF3B30', amber: '#FF9F0A', green: '#30B450',
  pad: 16,
};
export const hair = StyleSheet.hairlineWidth;
export const WIDE = 820;      // from this width: sidebar + list + conversation (iPad)
export const SIDEBAR = 250;
export const LISTW = 380;

// Avatar colours picked by a stable hash of the sender.
const AV = ['#FF6B6B', '#F59F00', '#51CF66', '#339AF0', '#845EF7', '#F06595', '#20C997', '#FF922B'];
export const avatarColor = (s = '') => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV[h % AV.length]; };
