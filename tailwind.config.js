/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        // 低饱和暖调色板：奶油底 + 灰绿主色 + 陶土点缀
        cream: '#FAF7F2',
        paper: '#FFFDFA',
        ink: '#3D3833',
        muted: '#918A81',
        line: '#EDE6DC',
        sage: {
          50: '#F3F5F0',
          100: '#E7ECE2',
          200: '#D2DCC9',
          300: '#B6C4AA',
          400: '#96A98A',
          500: '#7C9172',
          600: '#64775C'
        },
        clay: {
          50: '#FBF1EC',
          100: '#F3DFD5',
          200: '#E8CABC',
          300: '#D9AE99',
          500: '#C08972',
          600: '#A87460'
        },
        butter: '#F6ECD2'
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif'
        ]
      },
      maxWidth: {
        app: '480px'
      },
      borderRadius: {
        '4xl': '2rem'
      },
      boxShadow: {
        soft: '0 18px 40px -24px rgba(61, 56, 51, 0.28)',
        nav: '0 -8px 24px -18px rgba(61, 56, 51, 0.25)'
      }
    }
  },
  plugins: []
}
