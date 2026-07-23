import React, { useState } from 'react';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';

export default function ConfigurationWindowBody({ windowItem }) {
  const { notify } = useNotifications();
  const [dbUrl, setDbUrl] = useState('bolt://localhost:7687');
  const [dbUser, setDbUser] = useState('neo4j');
  const [dbPassword, setDbPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveConfig = (e) => {
    e.preventDefault();
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      notify({
        title: 'Configuration Saved',
        message: 'Graph database parameters updated.',
        level: 'success',
      });
    }, 400);
  };

  return (
    <div className="config_window_body">
      <form onSubmit={handleSaveConfig} className="config_form">
        <section className="config_section">
          <h2>Graph Database Connection (Neo4j)</h2>
          <div className="config_grid">
            <label>
              <span>Database URL</span>
              <input
                type="text"
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                placeholder="bolt://localhost:7687"
                required
              />
            </label>
            <label>
              <span>Username</span>
              <input
                type="text"
                value={dbUser}
                onChange={(e) => setDbUser(e.target.value)}
                placeholder="neo4j"
                required
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={dbPassword}
                onChange={(e) => setDbPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
          </div>
        </section>

        <section className="config_section">
          <h2>Ingestion Rules & Mapping</h2>
          <div className="config_grid">
            <label>
              <span>Node Identity Attribute</span>
              <input type="text" defaultValue="id" placeholder="id" />
            </label>
            <label>
              <span>Default Relationship Type</span>
              <input type="text" defaultValue="LINKED_TO" placeholder="LINKED_TO" />
            </label>
          </div>
        </section>

        <div className="config_actions">
          <button type="submit" className="config_btn_primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
}
