import { TextStyle } from 'react-native';

export const Fonts = {
  regular: 'NotoSerifJP_400Regular',
  medium: 'NotoSerifJP_500Medium',
  bold: 'NotoSerifJP_700Bold',
  monoNum: 'IBMPlexMono_600SemiBold',
} as const;

export type TextVariant =
  | 'heading'
  | 'sectionTitle'
  | 'bodyLg'
  | 'body'
  | 'caption'
  | 'meta'
  | 'buttonLabelSm'
  | 'buttonLabel'
  | 'buttonLabelLg';

const baseAndroidFix: TextStyle = {
  includeFontPadding: false,
  textAlignVertical: 'center',
};

export const typographyVariants: Record<TextVariant, TextStyle> = {
  heading:       { ...baseAndroidFix, fontFamily: Fonts.medium,  fontSize: 22, lineHeight: 30 },
  sectionTitle:  { ...baseAndroidFix, fontFamily: Fonts.medium,  fontSize: 17, lineHeight: 24 },
  bodyLg:        { ...baseAndroidFix, fontFamily: Fonts.regular, fontSize: 16, lineHeight: 22 },
  body:          { ...baseAndroidFix, fontFamily: Fonts.regular, fontSize: 15, lineHeight: 22 },
  caption:       { ...baseAndroidFix, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  meta:          { ...baseAndroidFix, fontFamily: Fonts.regular, fontSize: 11, lineHeight: 15 },
  buttonLabelSm: { ...baseAndroidFix, fontFamily: Fonts.medium,  fontSize: 13, lineHeight: 18 },
  buttonLabel:   { ...baseAndroidFix, fontFamily: Fonts.medium,  fontSize: 15, lineHeight: 20 },
  buttonLabelLg: { ...baseAndroidFix, fontFamily: Fonts.medium,  fontSize: 17, lineHeight: 22 },
};

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  | 'onAccent'
  | 'onDestructive'
  | 'inherit';
