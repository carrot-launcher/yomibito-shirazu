import React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { TextVariant } from '../constants/typography';
import { AppText } from './AppText';

export type AppButtonVariant =
  | 'primary'
  | 'secondary'
  | 'destructive'
  | 'caution'
  | 'outlineMuted'
  | 'outlineDestructive'
  | 'ghost'
  | 'link';
export type AppButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AppButtonProps extends Omit<TouchableOpacityProps, 'children'> {
  label: string;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

interface SizeSpec {
  paddingVertical: number;
  paddingHorizontal: number;
  minHeight: number;
  textVariant: TextVariant;
}

// sm/md/lg はアクセシビリティ最小タップ領域を保証するためライブラリ側で固定。
// sm=44 (iOS HIG 最低)、md=48 (Material 推奨)、lg=56 (プロミネントCTA)。
// xs はアクセシビリティ制約を外したインライン用。リスト行内や他のコンパクト要素
// と並ぶときだけ使う（それ以外は sm 以上を選ぶこと）。
const SIZE_SPECS: Record<AppButtonSize, SizeSpec> = {
  xs: { paddingVertical: 8,  paddingHorizontal: 14, minHeight: 0,  textVariant: 'buttonLabelSm' },
  sm: { paddingVertical: 8,  paddingHorizontal: 14, minHeight: 44, textVariant: 'buttonLabelSm' },
  md: { paddingVertical: 10, paddingHorizontal: 16, minHeight: 48, textVariant: 'buttonLabel' },
  lg: { paddingVertical: 14, paddingHorizontal: 20, minHeight: 56, textVariant: 'buttonLabelLg' },
};

export function AppButton({
  label,
  variant = 'primary',
  size = 'md',
  loading,
  leftIcon,
  rightIcon,
  fullWidth,
  disabled,
  style,
  ...rest
}: AppButtonProps) {
  const { colors } = useTheme();
  const spec = SIZE_SPECS[size];

  const { bg, border, textTone } = (() => {
    switch (variant) {
      case 'primary':
        return { bg: colors.accent, border: undefined, textTone: 'onAccent' as const };
      case 'secondary':
        return { bg: 'transparent', border: colors.border, textTone: 'primary' as const };
      case 'destructive':
        return { bg: colors.destructive, border: undefined, textTone: 'onDestructive' as const };
      case 'caution':
        return { bg: colors.caution, border: undefined, textTone: 'onDestructive' as const };
      case 'outlineMuted':
        return { bg: 'transparent', border: colors.textSecondary, textTone: 'secondary' as const };
      case 'outlineDestructive':
        return { bg: 'transparent', border: colors.destructive, textTone: 'destructive' as const };
      case 'ghost':
        return { bg: 'transparent', border: undefined, textTone: 'primary' as const };
      case 'link':
        return { bg: 'transparent', border: undefined, textTone: 'primary' as const };
    }
  })();

  const isLink = variant === 'link';

  const containerStyle: StyleProp<ViewStyle> = [
    {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: isLink ? 4 : spec.paddingVertical,
      paddingHorizontal: isLink ? 4 : spec.paddingHorizontal,
      minHeight: isLink ? undefined : spec.minHeight,
      backgroundColor: bg,
      borderRadius: isLink ? 0 : 10,
      borderWidth: border ? 1 : 0,
      borderColor: border,
      opacity: disabled || loading ? 0.4 : 1,
      // 既定は 'center'。親が 'stretch'(default) でも勝手に横幅100%にならず、
      // 'center'/'flex-start' などを指定していれば素直に従う。
      alignSelf: fullWidth ? 'stretch' : 'center',
      gap: 6,
    },
    style,
  ];

  const spinnerColor =
    variant === 'primary'
      ? colors.accentText
      : variant === 'destructive' || variant === 'caution'
        ? '#FFFFFF'
        : colors.text;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={disabled || loading}
      style={containerStyle}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <>
          {leftIcon ? <View>{leftIcon}</View> : null}
          <AppText
            variant={spec.textVariant}
            tone={textTone}
            style={isLink ? { textDecorationLine: 'underline' } : undefined}
          >
            {label}
          </AppText>
          {rightIcon ? <View>{rightIcon}</View> : null}
        </>
      )}
    </TouchableOpacity>
  );
}
