(function () {
    'use strict';

    var Manifest = {
        id: 'ph_plugin',
        version: '1.0.2',
        name: 'PH',
        description: 'Video plugin',
        component: 'ph_component',
        source: 'https://rt.pornhub.com',
        proxy: 'https://cors.eu.org/' 
    };

    var Lampa = window.Lampa;
    var Network = Lampa.Network;
    var Utils = Lampa.Utils;

    var DB = {
        get: function(name, def) {
            return Lampa.Storage.get('ph_' + name, def);
        },
        set: function(name, value) {
            Lampa.Storage.set('ph_' + name, value);
        }
    };

    var API = {
        request: function (url, success, error) {
            var proxy = DB.get('proxy', Manifest.proxy);
            var use_proxy = DB.get('use_proxy', true);
            var final_url = (use_proxy && url.indexOf('http') === 0) ? proxy + url : url;

            Network.silent(final_url, function (str) {
                success(str);
            }, function (a, c) {
                if(use_proxy) {
                     Network.silent(url, success, error);
                } else {
                    error(a, c);
                }
            });
        },
        
        parseCatalog: function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var items = [];
            var elements = doc.querySelectorAll('li.js-pop.videoblock, .pcVideoListItem, .videoblock'); 

            elements.forEach(function (el) {
                var linkEl = el.querySelector('.title a, .phimage a');
                var imgEl = el.querySelector('img');
                var titleEl = el.querySelector('.title a');
                var durEl = el.querySelector('.duration');
                var viewEl = el.querySelector('.views var');

                if (linkEl && imgEl) {
                    var img = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-mediumthumb') || imgEl.getAttribute('src');
                    var title = titleEl ? titleEl.getAttribute('title') || titleEl.innerText.trim() : 'Video';
                    
                    items.push({
                        url: linkEl.getAttribute('href'),
                        img: img,
                        title: title,
                        quality: durEl ? durEl.innerText.trim() : '',
                        year: viewEl ? viewEl.innerText.trim() : '',
                        type: 'video'
                    });
                }
            });

            var next_page = doc.querySelector('.pagination_next, .page_next a');
            var page = next_page ? next_page.getAttribute('href') : false;

            return { list: items, page: page };
        },

        parseFull: function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var title = doc.querySelector('.inlineFree');
            var desc = doc.querySelector('.video-metadata-description'); 
            var poster = doc.querySelector('#player-fluid-container img, .video-wrapper img');
            
            var video_urls = [];
            
            var flashvarsMatch = html.match(/flashvars_\d+\s*=\s*({.+?});/);
            
            if (flashvarsMatch) {
                try {
                    var json = JSON.parse(flashvarsMatch[1]);
                    if (json.mediaDefinitions) {
                        json.mediaDefinitions.forEach(function(media) {
                            if (media.videoUrl && media.format === 'mp4') {
                                var q = media.quality;
                                if(Array.isArray(q)) q = q[0]; 
                                video_urls.push({
                                    title: q + 'p',
                                    quality: parseInt(q),
                                    url: media.videoUrl
                                });
                            }
                        });
                    }
                } catch (e) {}
            }

            video_urls.sort(function(a,b){ return b.quality - a.quality; });

            return {
                title: title ? title.innerText.trim() : 'Video',
                description: desc ? desc.innerText.trim() : '',
                img: poster ? (poster.getAttribute('src') || '') : '',
                videos: video_urls
            };
        }
    };

    function PhComponent(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            
            this.activity.head = Lampa.Template.get('head', { title: 'PH' });
            
            this.activity.head.querySelector('.open--search').addEventListener('click', function(){
                Lampa.Input.edit({
                    title: 'Search',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    comp.activity.loader(true);
                    comp.startSearch(new_value);
                });
            });

            this.activity.line = Lampa.Template.get('items_line', { title: 'Recommended' });
            this.activity.render().find('.activity__body').append(this.activity.head);
            this.activity.render().find('.activity__body').append(this.activity.line);
            
            return this.render();
        };

        comp.startSearch = function(query) {
            this.url = Manifest.source + '/video/search?search=' + encodeURIComponent(query);
            this.page = 1;
            this.activity.line.find('.card').remove();
            this.load();
        };

        comp.start = function () {
            this.url = Manifest.source;
            this.page = 1;
            this.load();
        };

        comp.load = function () {
            var _this = this;
            var requestUrl = this.url;

            API.request(requestUrl, function (html) {
                var data = API.parseCatalog(html);
                _this.buildItems(data.list);
                _this.activity.loader(false);
                
                if (data.page) {
                    _this.url = data.page;
                    if(_this.url.indexOf('http') === -1) _this.url = Manifest.source + _this.url;
                } else {
                    _this.url = false;
                }
            }, function () {
                _this.activity.loader(false);
                _this.activity.empty();
            });
        };

        comp.buildItems = function (items) {
            var _this = this;
            
            if(!items.length) {
                Lampa.Noty.show('Empty');
                return;
            }

            items.forEach(function (item) {
                var card = Lampa.Template.get('card', {
                    title: item.title,
                    release_year: item.year
                });

                card.find('.card__view').append('<div class="card__quality">' + item.quality + '</div>');

                var img = card.find('.card__img')[0];
                var img_url = item.img;
                
                img.onload = function () { card.addClass('card--loaded'); };
                img.error = function () { img.src = './img/img_broken.svg'; };
                img.src = img_url;

                card.on('hover:enter', function () {
                    _this.openFull(item);
                });

                card.on('hover:long', function () {
                     Lampa.Select.show({
                        title: 'Menu',
                        items: [
                            { title: 'Favorite', to_fav: true },
                            { title: 'Close' }
                        ],
                        onSelect: function(a) {
                            if(a.to_fav) {
                                Lampa.Favorite.add('card', {
                                    id: Utils.uid(item.title),
                                    title: item.title,
                                    img: img_url,
                                    url: item.url,
                                    source: 'ph'
                                });
                            }
                        }
                     });
                });

                _this.activity.line.find('.card-loaded').remove();
                _this.activity.line.append(card);
            });
            
            if(this.url) {
                var more = Lampa.Template.get('more');
                more.on('hover:enter', function () {
                    _this.load();
                });
                this.activity.line.append(more);
            }
            
            this.activity.toggle();
        };

        comp.openFull = function (item) {
            var full_url = item.url;
            if(full_url.indexOf('http') === -1) full_url = Manifest.source + full_url;

            Lampa.Activity.push({
                url: full_url,
                title: item.title,
                component: 'ph_full',
                page: 1
            });
        };

        return comp;
    }

    function PhFull(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            var _this = this;
            API.request(object.url, function(html) {
                var data = API.parseFull(html);
                
                var desc = Lampa.Template.get('description', {
                    title: data.title,
                    descr: data.description
                });
                
                Lampa.Activity.active().activity.render().find('.background').attr('src', data.img);

                var buttons = $('<div class="buttons"></div>');
                
                var btn_play = Lampa.Template.get('button', { title: 'Play' });
                btn_play.on('hover:enter', function() {
                    if(data.videos.length > 0) {
                        _this.play(data);
                    } else {
                        Lampa.Noty.show('No video sources found');
                    }
                });
                buttons.append(btn_play);

                _this.activity.render().find('.activity__body').append(desc);
                _this.activity.render().find('.activity__body').append(buttons);
                _this.activity.loader(false);
                _this.activity.toggle();

            }, function() {
                _this.activity.empty();
            });
        };

        comp.play = function(data) {
            var items = data.videos.map(function(vid){
                return {
                    title: vid.title,
                    url: vid.url
                };
            });

            var playVideo = function(url) {
                var video = {
                    title: data.title,
                    url: url,
                    timeline: {
                        hash: Lampa.Utils.uid(data.title)
                    }
                };
                Lampa.Player.play(video);
                Lampa.Player.playlist([video]);
            };

            if(items.length > 1) {
                Lampa.Select.show({
                    title: 'Quality',
                    items: items,
                    onSelect: function(a) {
                        playVideo(a.url);
                    }
                });
            } else {
                playVideo(items[0].url);
            }
        };

        return comp;
    }

    function addSettings() {
        Lampa.Settings.listener.follow('open', function (e) {
            if (e.name == 'ph_settings') {
                var body = e.body;
                
                var createItem = function(name, key, def) {
                    var item = Lampa.Template.get('settings_param', {
                        name: name,
                        value: DB.get(key, def),
                        descr: ''
                    });
                    
                    item.on('hover:enter', function() {
                        Lampa.Input.edit({
                            title: name,
                            value: DB.get(key, def),
                            free: true
                        }, function(newVal) {
                            DB.set(key, newVal);
                            item.find('.settings-param__value').text(newVal);
                        });
                    });
                    
                    body.find('.settings-param__body').append(item);
                };

                createItem('CORS Proxy', 'proxy', Manifest.proxy);
                
                var toggle = Lampa.Template.get('settings_param', {
                     name: 'Use Proxy',
                     value: DB.get('use_proxy', true) ? 'Yes' : 'No'
                });
                toggle.on('hover:enter', function(){
                    var state = !DB.get('use_proxy', true);
                    DB.set('use_proxy', state);
                    toggle.find('.settings-param__value').text(state ? 'Yes' : 'No');
                });
                body.find('.settings-param__body').append(toggle);
            }
        });
    }

    if (!window.plugin_ph_ready) {
        window.plugin_ph_ready = true;
        
        Lampa.Component.add('ph_component', PhComponent);
        Lampa.Component.add('ph_full', PhFull);

        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') {
                var ico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"></path></svg>';
                
                var item = Lampa.Template.get('activity_menu_item', {
                    title: 'Ph',
                    icon: ico
                });

                item.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '',
                        title: 'PH',
                        component: 'ph_component',
                        page: 1
                    });
                });

                $('.activity__menu .activity__menu-list').append(item);
                
                Lampa.Settings.main().update();
                $('.settings__param').eq(0).after(Lampa.Template.get('settings_param', {
                    name: 'PH Settings',
                    component: 'ph_settings',
                    icon: ico
                }));
            }
        });
        
        addSettings();
        console.log('PH Plugin loaded');
    }

})();
