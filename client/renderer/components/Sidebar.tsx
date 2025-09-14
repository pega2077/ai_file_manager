import { Layout, Menu } from 'antd';
import { FolderOutlined, SettingOutlined } from '@ant-design/icons';

const { Sider } = Layout;

interface SidebarProps {
  selectedMenu: string;
  onMenuClick: ({ key }: { key: string }) => void;
}

const Sidebar = ({ selectedMenu, onMenuClick }: SidebarProps) => {
  const menuItems = [
    {
      key: 'files',
      icon: <FolderOutlined />,
      label: '文件管理',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
  ];

  return (
    <Sider width={200} style={{ background: '#fff' }}>
      <Menu
        mode="inline"
        selectedKeys={[selectedMenu]}
        style={{ height: '100%', borderRight: 0 }}
        items={menuItems}
        onClick={onMenuClick}
      />
    </Sider>
  );
};

export default Sidebar;