/*
 *
 * Copyright 2022 Elyra Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import React from 'react';
import { Provider } from 'react-redux';
import VisualEditor from './nlp-visual-editor';
import {
  Header,
  HeaderName,
  HeaderGlobalBar,
  HeaderGlobalAction,
} from 'carbon-components-react';
import { RiLogoutBoxRLine } from 'react-icons/ri';

import { store } from './redux/store';

const App = () => (
  <Provider store={store}>
    <Header aria-label="Elyra Open Source">
      <HeaderName href="#" prefix="Elyra">
        Visual Editor for NLP rules
      </HeaderName>
      <HeaderGlobalBar>
        <HeaderGlobalAction
          aria-label="Logout"
          tooltipAlignment="end"
          href="/appid/logout"
        >
          <RiLogoutBoxRLine size={20} />
        </HeaderGlobalAction>
      </HeaderGlobalBar>
    </Header>
    <VisualEditor />
  </Provider>
);

export default App;
