(function () {
    'use strict';

    var Manifest = {
        id: 'ph_premium_mod',
        version: '5.0.0',
        name: 'PH Premium',
        description: 'Просмотр видео с PH (RT/COM)',
        component: 'ph_mod_component'
    };

    var Lampa = window.Lampa;
    var Network = Lampa.Network;
    var Storage = Lampa.Storage;

    // --- Настройки по умолчанию ---
    var Settings = {
        get: function(name, def) {
            return Storage.get('ph_' + name, def);
        },
        set: function(name, value) {
            Storage.set('ph_' + name, value);
        }
    };

    // --- API & Network ---
    var Api = {
        // Получение базового URL (rt или www)
        source: function() {
            return Settings.get('domain', 'https://rt.pornhub.com');
        },

        // Генерация URL через прокси
        proxy: function(url) {
            var proxy_type = Settings.get('proxy_type', 'corsproxy');
            var custom = Settings.get('custom_proxy', '');

            if (proxy_type === 'custom' && custom) {
                return custom + encodeURIComponent(url);
            }
            if (proxy_type === 'allorigins') {
                return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
            }
            // По умолчанию corsproxy (самый стабильный для видео)
            return 'https://corsproxy.io/?' + encodeURIComponent(url);
        },

        request: function(method, success, error) {
            var url = this.source() + method;
            var final_url = this.proxy(url);

            // Заголовки для имитации браузера и обхода 18+
            var params = {
                headers: {
                    'Cookie': 'platform=pc; age_verified=1',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
                }
            };

            Network.silent(final_url, function(str) {
                // Проверки на ошибки внутри успешного ответа
                if (str.length < 500) {
                    Lampa.Noty.show('PH: Ответ слишком короткий. Проверьте прокси.');
                }
                if (str.indexOf('captcha') > -1) {
                    Lampa.Noty.show('PH: Капча! Смените прокси или IP.');
                }
                success(str);
            }, function(a, c) {
                error(a, c);
            }, params); // Передаем заголовки (работает не со всеми прокси, но corsproxy поддерживает)
        },

        // --- Парсинг Списка ---
        list: function(html) {
            var items = [];
            var doc = new DOMParser().parseFromString(html, 'text/html');
            
            // Универсальный селектор для всех версий дизайна
            var elements = doc.querySelectorAll('.pcVideoListItem, .videoblock, .js-pop.videoblock, li[data-video-id]');

            elements.forEach(function(el) {
                var linkEl = el.querySelector('a:not(.userLink)');
                var imgEl = el.querySelector('img');
                var titleEl = el.querySelector('.title a, .videoTitle');
                var durEl = el.querySelector('.duration');
                var viewEl = el.querySelector('.views var, .views');

                if (linkEl && imgEl) {
                    var link = linkEl.getAttribute('href');
                    if (!link || link.indexOf('viewkey') === -1) return;

                    var title = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText.trim()) : 'Video';
                    
                    // PH часто хранит картинку в data-атрибутах для lazy load
                    var img = imgEl.getAttribute('data-mediumthumb') || 
                              imgEl.getAttribute('data-src') || 
                              imgEl.getAttribute('data-thumb_url') || 
                              imgEl.src;

                    var duration = durEl ? durEl.innerText.trim() : '';
                    var views = viewEl ? viewEl.innerText.trim() : '';

                    items.push({
                        type: 'video',
                        title: title,
                        url: link,
                        img: img,
                        info: duration + (views ? ' / ' + views : ''),
                        duration: duration
                    });
                }
            });

            // Пагинация
            var nextEl = doc.querySelector('.pagination_next a, .page_next a, #next');
            var next_page = nextEl ? nextEl.getAttribute('href') : false;

            return { results: items, page: next_page };
        },

        // --- Парсинг Видео (Экстракция JSON) ---
        extract: function(html) {
            // Ищем JSON конфиг плеера (flashvars)
            var match = html.match(/flashvars_\d+\s*=\s*({.+?});/) || html.match(/var\s+flashvars\s*=\s*({.+?});/);
            var result = {};

            if (match) {
                try {
                    var json = JSON.parse(match[1]);
                    result = {
                        title: json.video_title,
                        img: json.image_url,
                        videos: []
                    };

                    if (json.mediaDefinitions) {
                        json.mediaDefinitions.forEach(function(v) {
                            if (v.format === 'mp4' && v.videoUrl) {
                                var q = Array.isArray(v.quality) ? v.quality[0] : v.quality;
                                result.videos.push({
                                    title: q + 'p',
                                    quality: parseInt(q) || 0,
                                    url: v.videoUrl
                                });
                            }
                        });
                    }
                    // Сортировка по качеству (лучшее сверху)
                    result.videos.sort(function(a, b) { return b.quality - a.quality });
                } catch (e) { console.error('PH JSON Error', e); }
            }
            return result;
        }
    };

    // --- Компонент Каталога ---
    function Component(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function() {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function() {
            this.build();
        };

        comp.build = function() {
            var _this = this;
            
            // Шапка
            this.activity.head = Lampa.Template.get('head', { title: 'PH Premium' });
            
            // Кнопка поиска
            this.activity.head.querySelector('.open--search').addEventListener('click', function() {
                Lampa.Input.edit({
                    title: 'Поиск видео',
                    value: '',
                    free: true,
                    nosave: true
                }, function(new_value) {
                    _this.activity.line.find('.card').remove();
                    _this.activity.loader(true);
                    _this.load('/video/search?search=' + encodeURIComponent(new_value));
                });
            });

            // Кнопка настроек в шапке (рядом с поиском)
            var settingsBtn = $('<div class="open--settings selector"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1.5em; height: 1.5em;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></div>');
            settingsBtn.on('click', function() {
                Lampa.Settings.open();
                // Небольшой хак чтобы сразу открыть наши настройки, если получится, или просто открыть меню
                setTimeout(function(){ $('[data-component="ph_settings"]').trigger('click'); }, 300);
            });
            this.activity.head.find('.open--search').after(settingsBtn);


            this.activity.line = Lampa.Template.get('items_line', { title: 'Рекомендации' });
            this.activity.render().find('.activity__body').append(this.activity.head);
            this.activity.render().find('.activity__body').append(this.activity.line);
            
            this.load('/');
        };

        comp.load = function(endpoint) {
            var _this = this;
            
            Api.request(endpoint, function(html) {
                var data = Api.list(html);
                
                if (data.results.length === 0) {
                    var empty = Lampa.Template.get('empty', {
                        title: 'Пусто',
                        descr: 'Не удалось получить видео. Попробуйте сменить Прокси или Домен в настройках плагина.'
                    });
                    _this.activity.line.append(empty);
                } else {
                    _this.append(data);
                }
                
                _this.activity.loader(false);
            }, function(a, c) {
                _this.activity.loader(false);
                Lampa.Noty.show('Ошибка сети: ' + c);
                var empty = Lampa.Template.get('empty', { title: 'Ошибка', descr: c });
                _this.activity.line.append(empty);
            });
        };

        comp.append = function(data) {
            var _this = this;
            
            data.results.forEach(function(element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: element.info
                });
                
                card.addClass('card--video');
                var img = card.find('.card__img')[0];
                img.onload = function() { card.addClass('card--loaded'); };
                img.onerror = function() { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                // Клик -> Открыть видео
                card.on('hover:enter', function() {
                    Lampa.Activity.push({
                        url: element.url,
                        title: element.title,
                        component: 'ph_mod_view',
                        page: 1
                    });
                });

                // Долгое нажатие -> Избранное
                card.on('hover:long', function() {
                     Lampa.Select.show({
                        title: 'Меню',
                        items: [{ title: 'В избранное', fav: true }, { title: 'Отмена' }],
                        onSelect: function(a) {
                            if(a.fav) {
                                Lampa.Favorite.add('card', {
                                    id: Lampa.Utils.uid(element.title),
                                    title: element.title,
                                    img: element.img,
                                    url: element.url,
                                    source: 'ph_mod'
                                });
                                Lampa.Noty.show('Добавлено!');
                            }
                        }
                     });
                });
                
                _this.activity.line.append(card);
            });

            if (data.page) {
                var more = Lampa.Template.get('more');
                more.on('hover:enter', function() {
                    _this.activity.line.find('.selector').remove(); // удаляем кнопку
                    _this.load(data.page);
                });
                this.activity.line.append(more);
            }
            
            this.activity.toggle();
        };

        return comp;
    }

    // --- Компонент Просмотра ---
    function View(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function() {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function() {
            var _this = this;
            Api.request(object.url, function(html) {
                var data = Api.extract(html);
                if (data.videos && data.videos.length) {
                    _this.show(data);
                } else {
                    Lampa.Noty.show('Видео-ссылки не найдены (Возможно нужен Premium)');
                    _this.activity.empty();
                }
            }, function() {
                _this.activity.empty();
            });
        };
        
        comp.show = function(data) {
            var _this = this;
            var desc = Lampa.Template.get('description', {
                title: data.title,
                descr: 'Нажмите Play для просмотра'
            });
            
            Lampa.Activity.active().activity.render().find('.background').attr('src', data.img);

            var btn = Lampa.Template.get('button', { title: 'Смотреть' });
            btn.on('hover:enter', function() {
                Lampa.Select.show({
                    title: 'Качество',
                    items: data.videos,
                    onSelect: function(v) {
                        var vid = {
                            title: data.title,
                            url: v.url,
                            timeline: { hash: Lampa.Utils.uid(data.title) }
                        };
                        Lampa.Player.play(vid);
                        Lampa.Player.playlist([vid]);
                    }
                });
            });
            
            this.activity.render().find('.activity__body').append(desc);
            this.activity.render().find('.activity__body').append(btn);
            this.activity.loader(false);
            this.activity.toggle();
        };

        return comp;
    }

    // --- Добавляем настройки в меню Lampa ---
    function addSettings() {
        Lampa.SettingsApi.addParam({
            component: 'ph_settings',
            param: {
                name: 'ph_domain',
                type: 'select',
                values: {
                    'https://rt.pornhub.com': 'RT (Russia)',
                    'https://www.pornhub.com': 'WWW (Global)'
                },
                default: 'https://rt.pornhub.com'
            },
            field: {
                name: 'Домен PH',
                description: 'Выберите зеркало сайта'
            },
            onChange: function(value) {
                Settings.set('domain', value);
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'ph_settings',
            param: {
                name: 'ph_proxy_type',
                type: 'select',
                values: {
                    'corsproxy': 'CorsProxy.io (Рекомендуется)',
                    'allorigins': 'AllOrigins',
                    'custom': 'Свой прокси'
                },
                default: 'corsproxy'
            },
            field: {
                name: 'Тип Прокси',
                description: 'Метод обхода блокировок'
            },
            onChange: function(value) {
                Settings.set('proxy_type', value);
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'ph_settings',
            param: {
                name: 'ph_custom_proxy',
                type: 'input',
                default: ''
            },
            field: {
                name: 'Свой прокси URL',
                description: 'Если выбран "Свой прокси". Пример: https://myproxy.com/?url='
            },
            onChange: function(value) {
                Settings.set('custom_proxy', value);
            }
        });
    }

    // --- Инициализация ---
    if (!window.ph_premium_ready) {
        window.ph_premium_ready = true;
        
        Lampa.Component.add('ph_mod_component', Component);
        Lampa.Component.add('ph_mod_view', View);

        // Добавляем пункт в настройки
        addSettings();

        // Добавляем иконку в меню
        Lampa.Listener.follow('app', function(e) {
            if (e.type == 'ready') {
                var ico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'; // Иконка меню
                var item = Lampa.Template.get('activity_menu_item', {
                    title: 'PH Premium',
                    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 12a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0Z"/><path d="M10 8l6 4-6 4V8z"/></svg>'
                });

                item.on('hover:enter', function() {
                    Lampa.Activity.push({
                        url: '',
                        title: 'PH',
                        component: 'ph_mod_component',
                        page: 1
                    });
                });

                $('.activity__menu .activity__menu-list').append(item);
                
                // Добавляем пункт "PH Настройки" в общие настройки
                var settingItem = Lampa.Template.get('settings_param', {
                    name: 'PH Настройки',
                    component: 'ph_settings',
                    icon: item.find('svg').prop('outerHTML')
                });
                $('.settings__param').last().after(settingItem);
            }
        });
        
        console.log('PH Premium Mod Loaded');
    }
})();
