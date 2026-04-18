import React from 'react';
import { Text, TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Fonts, TextTone, TextVariant, typographyVariants } from '../constants/typography';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: 'regular' | 'medium' | 'bold';
}

export function AppText({
  variant = 'body',
  tone = 'primary',
  weight,
  style,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();

  const color = (() => {
    switch (tone) {
      case 'primary': return colors.text;
      case 'secondary': return colors.textSecondary;
      case 'tertiary': return colors.textTertiary;
      case 'destructive': return colors.destructive;
      case 'onAccent': return colors.accentText;
      case 'onDestructive': return '#FFFFFF';
      case 'inherit': return undefined;
    }
  })();

  const weightOverride = weight
    ? { fontFamily: weight === 'regular' ? Fonts.regular : weight === 'medium' ? Fonts.medium : Fonts.bold }
    : null;

  return (
    <Text
      {...rest}
      style={[
        typographyVariants[variant],
        weightOverride,
        color !== undefined && { color },
        style,
      ]}
    />
  );
}
