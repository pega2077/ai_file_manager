import { useContext } from "react";
import { ThemeContext, type ThemeContextValue } from "./context";

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
};
